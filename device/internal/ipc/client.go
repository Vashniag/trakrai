package ipc

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"sync"
	"time"
)

const (
	ipcReconnectInitialDelay = time.Second
	ipcReconnectMaxDelay     = 15 * time.Second
	ipcWaitForReadyTimeout   = 500 * time.Millisecond
	ipcRequestTimeout        = 2 * time.Second
)

var (
	errIPCClosed       = errors.New("IPC client is closed")
	errIPCDisconnected = errors.New("IPC connection is unavailable")
)

type Client struct {
	socketPath string
	service    string
	log        *slog.Logger

	writeMu   sync.Mutex
	pendingMu sync.Mutex
	pending   map[string]chan Response

	statusMu   sync.RWMutex
	lastStatus *StatusReport

	stateMu        sync.RWMutex
	conn           net.Conn
	connGeneration uint64
	readyCh        chan struct{}

	reconnectMu  sync.Mutex
	reconnecting bool

	startOnce sync.Once
	closeOnce sync.Once
	closedCh  chan struct{}

	notifications chan Notification
}

func NewClient(socketPath string, service string) *Client {
	return &Client{
		socketPath:    socketPath,
		service:       service,
		log:           slog.With("component", "ipc-client", "service", service),
		pending:       make(map[string]chan Response),
		readyCh:       make(chan struct{}),
		closedCh:      make(chan struct{}),
		notifications: make(chan Notification, 32),
	}
}

func (c *Client) Start() {
	c.startOnce.Do(func() {
		c.ensureReconnectLoop()
	})
}

func (c *Client) Connect(ctx context.Context) error {
	c.Start()
	return c.WaitUntilConnected(ctx)
}

func (c *Client) WaitUntilConnected(ctx context.Context) error {
	for {
		if c.isClosed() {
			return errIPCClosed
		}

		c.stateMu.RLock()
		conn := c.conn
		readyCh := c.readyCh
		c.stateMu.RUnlock()

		if conn != nil {
			return nil
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-c.closedCh:
			return errIPCClosed
		case <-readyCh:
		}
	}
}

func (c *Client) Notifications() <-chan Notification {
	return c.notifications
}

func (c *Client) Publish(subtopic string, msgType string, payload interface{}) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal publish payload: %w", err)
	}

	_, err = c.request("publish-message", PublishMessageRequest{
		Service:  c.service,
		Subtopic: subtopic,
		Type:     msgType,
		Payload:  data,
	}, 2)
	return err
}

func (c *Client) SendServiceMessage(targetService string, subtopic string, msgType string, payload interface{}) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal service payload: %w", err)
	}

	_, err = c.request("send-service-message", SendServiceMessageRequest{
		TargetService: targetService,
		Subtopic:      subtopic,
		Type:          msgType,
		Payload:       data,
	}, 2)
	return err
}

func (c *Client) ReportStatus(status string, details map[string]interface{}) error {
	report := StatusReport{
		Service: c.service,
		Status:  status,
		Details: cloneDetailsMap(details),
	}
	c.storeLastStatus(report)

	_, err := c.request("report-status", report, 1)
	return err
}

func (c *Client) ReportError(message string, fatal bool) error {
	_, err := c.request("report-error", ErrorReport{
		Service: c.service,
		Error:   message,
		Fatal:   fatal,
	}, 1)
	return err
}

func (c *Client) request(method string, params interface{}, maxAttempts int) (*Response, error) {
	if maxAttempts <= 0 {
		maxAttempts = 1
	}

	paramsData, err := json.Marshal(params)
	if err != nil {
		return nil, err
	}

	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		resp, reqErr := c.tryRequest(method, paramsData)
		if reqErr == nil {
			return resp, nil
		}
		lastErr = reqErr
		if !errors.Is(reqErr, errIPCDisconnected) || attempt == maxAttempts || c.isClosed() {
			break
		}
	}

	return nil, lastErr
}

func (c *Client) tryRequest(method string, paramsData []byte) (*Response, error) {
	conn, generation, err := c.waitForConnection(ipcWaitForReadyTimeout)
	if err != nil {
		return nil, err
	}

	reqID := fmt.Sprintf("%d", time.Now().UnixNano())
	respCh := make(chan Response, 1)

	c.pendingMu.Lock()
	c.pending[reqID] = respCh
	c.pendingMu.Unlock()

	reqData, err := json.Marshal(Request{
		ID:     reqID,
		Method: method,
		Params: paramsData,
	})
	if err != nil {
		c.removePending(reqID)
		return nil, err
	}

	if err := c.writeLine(conn, generation, reqData); err != nil {
		c.removePending(reqID)
		return nil, err
	}

	timer := time.NewTimer(ipcRequestTimeout)
	defer timer.Stop()

	select {
	case resp, ok := <-respCh:
		if !ok {
			return nil, errIPCDisconnected
		}
		if resp.Error != nil {
			return nil, fmt.Errorf(resp.Error.Message)
		}
		return &resp, nil
	case <-timer.C:
		c.removePending(reqID)
		c.markDisconnected(conn, generation, fmt.Errorf("IPC request %q timed out", method))
		return nil, errIPCDisconnected
	case <-c.closedCh:
		c.removePending(reqID)
		return nil, errIPCClosed
	}
}

func (c *Client) waitForConnection(timeout time.Duration) (net.Conn, uint64, error) {
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	for {
		if c.isClosed() {
			return nil, 0, errIPCClosed
		}

		c.stateMu.RLock()
		conn := c.conn
		generation := c.connGeneration
		readyCh := c.readyCh
		c.stateMu.RUnlock()

		if conn != nil {
			return conn, generation, nil
		}

		select {
		case <-c.closedCh:
			return nil, 0, errIPCClosed
		case <-timer.C:
			return nil, 0, errIPCDisconnected
		case <-readyCh:
		}
	}
}

func (c *Client) writeLine(conn net.Conn, generation uint64, data []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()

	if !c.isCurrentConnection(conn, generation) {
		return errIPCDisconnected
	}

	data = append(data, '\n')
	if _, err := conn.Write(data); err != nil {
		c.markDisconnected(conn, generation, err)
		return errIPCDisconnected
	}
	return nil
}

func (c *Client) readLoop(conn net.Conn, generation uint64) {
	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 64*1024), 512*1024)

	for scanner.Scan() {
		line := scanner.Bytes()

		var envelope struct {
			ID     string `json:"id"`
			Method string `json:"method"`
		}
		if err := json.Unmarshal(line, &envelope); err != nil {
			c.log.Warn("invalid IPC frame", "error", err)
			continue
		}

		switch {
		case envelope.ID != "":
			var resp Response
			if err := json.Unmarshal(line, &resp); err != nil {
				c.log.Warn("invalid IPC response", "error", err)
				continue
			}
			c.pendingMu.Lock()
			respCh := c.pending[resp.ID]
			delete(c.pending, resp.ID)
			c.pendingMu.Unlock()
			if respCh != nil {
				respCh <- resp
				close(respCh)
			}

		case envelope.Method != "":
			var notification Notification
			if err := json.Unmarshal(line, &notification); err != nil {
				c.log.Warn("invalid IPC notification", "error", err)
				continue
			}
			select {
			case c.notifications <- notification:
			case <-c.closedCh:
				return
			}
		}
	}

	if err := scanner.Err(); err != nil && !c.isClosed() {
		c.log.Warn("IPC read loop stopped", "error", err)
	}

	c.markDisconnected(conn, generation, scanner.Err())
}

func (c *Client) ensureReconnectLoop() {
	c.reconnectMu.Lock()
	if c.reconnecting || c.isClosed() {
		c.reconnectMu.Unlock()
		return
	}
	c.reconnecting = true
	c.reconnectMu.Unlock()

	go c.reconnectLoop()
}

func (c *Client) reconnectLoop() {
	defer func() {
		c.reconnectMu.Lock()
		c.reconnecting = false
		c.reconnectMu.Unlock()
	}()

	delay := ipcReconnectInitialDelay

	for {
		if c.isClosed() {
			return
		}

		if c.hasConnection() {
			return
		}

		conn, err := net.Dial("unix", c.socketPath)
		if err == nil {
			if err = c.registerService(conn); err == nil {
				generation := c.activateConnection(conn)
				c.log.Info("IPC connected", "socket", c.socketPath)
				go c.readLoop(conn, generation)
				go c.replayLastStatus()
				return
			}
			_ = conn.Close()
		}

		if !c.isClosed() {
			c.log.Warn("IPC connect failed, retrying",
				"socket", c.socketPath,
				"error", err,
				"retry_in", delay.String(),
			)
		}

		select {
		case <-c.closedCh:
			return
		case <-time.After(delay):
		}

		delay *= 2
		if delay > ipcReconnectMaxDelay {
			delay = ipcReconnectMaxDelay
		}
	}
}

func (c *Client) registerService(conn net.Conn) error {
	paramsData, err := json.Marshal(RegisterServiceRequest{Service: c.service})
	if err != nil {
		return err
	}

	reqData, err := json.Marshal(Request{
		ID:     fmt.Sprintf("register-%d", time.Now().UnixNano()),
		Method: "register-service",
		Params: paramsData,
	})
	if err != nil {
		return err
	}

	if err := conn.SetDeadline(time.Now().Add(ipcRequestTimeout)); err != nil {
		return err
	}
	defer conn.SetDeadline(time.Time{})

	if _, err := conn.Write(append(reqData, '\n')); err != nil {
		return err
	}

	reader := bufio.NewReader(conn)
	line, err := reader.ReadBytes('\n')
	if err != nil {
		return err
	}

	var resp Response
	if err := json.Unmarshal(line, &resp); err != nil {
		return err
	}
	if resp.Error != nil {
		return fmt.Errorf(resp.Error.Message)
	}

	return nil
}

func (c *Client) activateConnection(conn net.Conn) uint64 {
	c.stateMu.Lock()
	defer c.stateMu.Unlock()

	c.conn = conn
	c.connGeneration++
	generation := c.connGeneration
	close(c.readyCh)
	return generation
}

func (c *Client) replayLastStatus() {
	status := c.loadLastStatus()
	if status == nil || c.isClosed() {
		return
	}

	if _, err := c.request("report-status", *status, 1); err != nil && !errors.Is(err, errIPCClosed) {
		c.log.Debug("status replay failed", "error", err)
	}
}

func (c *Client) markDisconnected(conn net.Conn, generation uint64, cause error) {
	c.stateMu.Lock()
	if c.conn != conn || c.connGeneration != generation {
		c.stateMu.Unlock()
		return
	}
	c.conn = nil
	c.readyCh = make(chan struct{})
	c.stateMu.Unlock()

	_ = conn.Close()
	c.failPending()

	if cause != nil && !c.isClosed() {
		c.log.Warn("IPC connection lost, reconnecting", "error", cause)
	}

	c.ensureReconnectLoop()
}

func (c *Client) failPending() {
	c.pendingMu.Lock()
	defer c.pendingMu.Unlock()

	for id, respCh := range c.pending {
		close(respCh)
		delete(c.pending, id)
	}
}

func (c *Client) removePending(id string) {
	c.pendingMu.Lock()
	defer c.pendingMu.Unlock()
	if respCh := c.pending[id]; respCh != nil {
		delete(c.pending, id)
	}
}

func (c *Client) storeLastStatus(report StatusReport) {
	c.statusMu.Lock()
	defer c.statusMu.Unlock()

	statusCopy := report
	statusCopy.Details = cloneDetailsMap(report.Details)
	c.lastStatus = &statusCopy
}

func (c *Client) loadLastStatus() *StatusReport {
	c.statusMu.RLock()
	defer c.statusMu.RUnlock()

	if c.lastStatus == nil {
		return nil
	}

	statusCopy := *c.lastStatus
	statusCopy.Details = cloneDetailsMap(c.lastStatus.Details)
	return &statusCopy
}

func cloneDetailsMap(details map[string]interface{}) map[string]interface{} {
	if len(details) == 0 {
		return nil
	}

	data, err := json.Marshal(details)
	if err != nil {
		cloned := make(map[string]interface{}, len(details))
		for key, value := range details {
			cloned[key] = value
		}
		return cloned
	}

	var cloned map[string]interface{}
	if err := json.Unmarshal(data, &cloned); err != nil {
		cloned = make(map[string]interface{}, len(details))
		for key, value := range details {
			cloned[key] = value
		}
	}
	return cloned
}

func (c *Client) hasConnection() bool {
	c.stateMu.RLock()
	defer c.stateMu.RUnlock()
	return c.conn != nil
}

func (c *Client) isCurrentConnection(conn net.Conn, generation uint64) bool {
	c.stateMu.RLock()
	defer c.stateMu.RUnlock()
	return c.conn == conn && c.connGeneration == generation
}

func (c *Client) isClosed() bool {
	select {
	case <-c.closedCh:
		return true
	default:
		return false
	}
}

func (c *Client) Close() {
	c.closeOnce.Do(func() {
		close(c.closedCh)

		c.stateMu.Lock()
		conn := c.conn
		c.conn = nil
		c.readyCh = make(chan struct{})
		c.stateMu.Unlock()

		if conn != nil {
			_ = conn.Close()
		}
		c.failPending()
	})
}
