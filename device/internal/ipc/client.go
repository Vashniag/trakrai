package ipc

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"sync"
	"time"
)

type Client struct {
	socketPath    string
	service       string
	log           *slog.Logger
	conn          net.Conn
	writeMu       sync.Mutex
	pendingMu     sync.Mutex
	pending       map[string]chan Response
	notifications chan Notification
}

func NewClient(socketPath string, service string) *Client {
	return &Client{
		socketPath:    socketPath,
		service:       service,
		log:           slog.With("component", "ipc-client", "service", service),
		pending:       make(map[string]chan Response),
		notifications: make(chan Notification, 32),
	}
}

func (c *Client) Connect() error {
	conn, err := net.Dial("unix", c.socketPath)
	if err != nil {
		return fmt.Errorf("dial IPC socket: %w", err)
	}

	c.conn = conn
	go c.readLoop()

	if _, err := c.request("register-service", RegisterServiceRequest{Service: c.service}); err != nil {
		_ = conn.Close()
		return fmt.Errorf("register service: %w", err)
	}

	return nil
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
	})
	return err
}

func (c *Client) ReportStatus(status string, details map[string]interface{}) error {
	_, err := c.request("report-status", StatusReport{
		Service: c.service,
		Status:  status,
		Details: details,
	})
	return err
}

func (c *Client) ReportError(message string, fatal bool) error {
	_, err := c.request("report-error", ErrorReport{
		Service: c.service,
		Error:   message,
		Fatal:   fatal,
	})
	return err
}

func (c *Client) request(method string, params interface{}) (*Response, error) {
	if c.conn == nil {
		return nil, fmt.Errorf("IPC client is not connected")
	}

	paramsData, err := json.Marshal(params)
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

	if err := c.writeLine(reqData); err != nil {
		c.removePending(reqID)
		return nil, err
	}

	select {
	case resp, ok := <-respCh:
		if !ok {
			return nil, fmt.Errorf("IPC connection closed")
		}
		if resp.Error != nil {
			return nil, fmt.Errorf(resp.Error.Message)
		}
		return &resp, nil
	case <-time.After(5 * time.Second):
		c.removePending(reqID)
		return nil, fmt.Errorf("IPC request %q timed out", method)
	}
}

func (c *Client) writeLine(data []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()

	data = append(data, '\n')
	_, err := c.conn.Write(data)
	return err
}

func (c *Client) readLoop() {
	defer close(c.notifications)

	scanner := bufio.NewScanner(c.conn)
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
			c.notifications <- notification
		}
	}

	if err := scanner.Err(); err != nil {
		c.log.Warn("IPC read loop stopped", "error", err)
	}

	c.pendingMu.Lock()
	for id, respCh := range c.pending {
		respCh <- Response{
			ID: id,
			Error: &Error{
				Code:    -32000,
				Message: "IPC connection closed",
			},
		}
		close(respCh)
		delete(c.pending, id)
	}
	c.pendingMu.Unlock()
}

func (c *Client) removePending(id string) {
	c.pendingMu.Lock()
	defer c.pendingMu.Unlock()
	delete(c.pending, id)
}

func (c *Client) Close() {
	if c.conn != nil {
		_ = c.conn.Close()
	}
}
