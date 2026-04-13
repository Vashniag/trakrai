package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"os"
	"sync"
)

type serviceClient struct {
	conn net.Conn
	name string
	mu   sync.Mutex
}

func (c *serviceClient) writeJSON(value interface{}) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	data = append(data, '\n')
	_, err = c.conn.Write(data)
	return err
}

func (c *serviceClient) serviceName() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.name
}

func (c *serviceClient) setServiceName(name string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.name = name
}

type IPCServer struct {
	listener net.Listener
	log      *slog.Logger
	mu       sync.RWMutex
	statuses map[string]StatusReport
	services map[string]*serviceClient
	publish  func(PublishMessageRequest) error
}

func NewIPCServer(socketPath string) (*IPCServer, error) {
	_ = os.Remove(socketPath)

	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return nil, err
	}

	return &IPCServer{
		listener: listener,
		log:      slog.With("component", "ipc"),
		statuses: make(map[string]StatusReport),
		services: make(map[string]*serviceClient),
	}, nil
}

func (s *IPCServer) SetPublisher(publish func(PublishMessageRequest) error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.publish = publish
}

func (s *IPCServer) Serve(ctx context.Context) {
	s.log.Info("IPC server listening", "path", s.listener.Addr().String())

	go func() {
		<-ctx.Done()
		_ = s.listener.Close()
	}()

	for {
		conn, err := s.listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			s.log.Error("accept failed", "error", err)
			continue
		}
		go s.handleConnection(ctx, conn)
	}
}

func (s *IPCServer) handleConnection(ctx context.Context, conn net.Conn) {
	client := &serviceClient{conn: conn}
	defer func() {
		s.unregister(client)
		_ = conn.Close()
	}()

	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 64*1024), 512*1024)

	for scanner.Scan() {
		if ctx.Err() != nil {
			return
		}

		var req IPCRequest
		if err := json.Unmarshal(scanner.Bytes(), &req); err != nil {
			s.log.Error("invalid IPC request", "error", err)
			continue
		}

		resp := s.handleRequest(client, req)
		if err := client.writeJSON(resp); err != nil {
			s.log.Warn("write IPC response failed", "service", client.serviceName(), "error", err)
			return
		}
	}

	if err := scanner.Err(); err != nil && ctx.Err() == nil {
		s.log.Warn("IPC connection closed", "service", client.serviceName(), "error", err)
	}
}

func (s *IPCServer) handleRequest(client *serviceClient, req IPCRequest) IPCResponse {
	switch req.Method {
	case "register-service":
		var registerReq RegisterServiceRequest
		if err := json.Unmarshal(req.Params, &registerReq); err != nil {
			return IPCResponse{ID: req.ID, Error: &IPCError{Code: -1, Message: err.Error()}}
		}
		if registerReq.Service == "" {
			return IPCResponse{ID: req.ID, Error: &IPCError{Code: -3, Message: "service name is required"}}
		}

		client.setServiceName(registerReq.Service)

		s.mu.Lock()
		if existing := s.services[registerReq.Service]; existing != nil && existing != client {
			s.log.Warn("replacing existing IPC service registration", "service", registerReq.Service)
		}
		s.services[registerReq.Service] = client
		s.statuses[registerReq.Service] = StatusReport{
			Service: registerReq.Service,
			Status:  "registered",
		}
		s.mu.Unlock()

		s.log.Info("service registered", "service", registerReq.Service)
		return okResponse(req.ID)

	case "publish-message":
		var publishReq PublishMessageRequest
		if err := json.Unmarshal(req.Params, &publishReq); err != nil {
			return IPCResponse{ID: req.ID, Error: &IPCError{Code: -1, Message: err.Error()}}
		}
		if publishReq.Subtopic == "" || publishReq.Type == "" {
			return IPCResponse{ID: req.ID, Error: &IPCError{Code: -4, Message: "subtopic and type are required"}}
		}
		if publishReq.Service == "" {
			publishReq.Service = client.serviceName()
		}

		s.mu.RLock()
		publisher := s.publish
		s.mu.RUnlock()
		if publisher == nil {
			return IPCResponse{ID: req.ID, Error: &IPCError{Code: -5, Message: "MQTT publisher is not ready"}}
		}
		if err := publisher(publishReq); err != nil {
			return IPCResponse{ID: req.ID, Error: &IPCError{Code: -6, Message: err.Error()}}
		}
		return okResponse(req.ID)

	case "report-status":
		var report StatusReport
		if err := json.Unmarshal(req.Params, &report); err != nil {
			return IPCResponse{ID: req.ID, Error: &IPCError{Code: -1, Message: err.Error()}}
		}
		if report.Service == "" {
			report.Service = client.serviceName()
		}
		s.mu.Lock()
		s.statuses[report.Service] = report
		s.mu.Unlock()
		s.log.Info("status report", "service", report.Service, "status", report.Status)
		return okResponse(req.ID)

	case "report-error":
		var report ErrorReport
		if err := json.Unmarshal(req.Params, &report); err != nil {
			return IPCResponse{ID: req.ID, Error: &IPCError{Code: -1, Message: err.Error()}}
		}
		if report.Service == "" {
			report.Service = client.serviceName()
		}
		s.log.Error("error report from service", "service", report.Service, "error", report.Error, "fatal", report.Fatal)
		return okResponse(req.ID)

	default:
		return IPCResponse{ID: req.ID, Error: &IPCError{Code: -2, Message: "unknown method: " + req.Method}}
	}
}

func okResponse(id string) IPCResponse {
	result, _ := json.Marshal(map[string]bool{"ok": true})
	return IPCResponse{ID: id, Result: result}
}

func (s *IPCServer) unregister(client *serviceClient) {
	service := client.serviceName()
	if service == "" {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if current := s.services[service]; current == client {
		delete(s.services, service)
	}
	s.statuses[service] = StatusReport{
		Service: service,
		Status:  "stopped",
		Details: map[string]interface{}{"reason": "ipc disconnected"},
	}
	s.log.Info("service unregistered", "service", service)
}

func (s *IPCServer) NotifyService(service string, message MqttMessageNotification) error {
	s.mu.RLock()
	client := s.services[service]
	s.mu.RUnlock()
	if client == nil {
		return fmt.Errorf("service %q is not registered", service)
	}

	params, err := json.Marshal(message)
	if err != nil {
		return err
	}

	notification := IPCNotification{
		Method: "mqtt-message",
		Params: params,
	}
	return client.writeJSON(notification)
}

func (s *IPCServer) GetStatuses() map[string]StatusReport {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make(map[string]StatusReport, len(s.statuses))
	for k, v := range s.statuses {
		out[k] = v
	}
	return out
}

func (s *IPCServer) Close() {
	_ = s.listener.Close()
}
