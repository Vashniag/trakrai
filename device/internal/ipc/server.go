package ipc

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"os"
	"sync"
	"time"
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

type Server struct {
	listener net.Listener
	log      *slog.Logger
	mu       sync.RWMutex
	statuses map[string]StatusReport
	services map[string]*serviceClient
	publish  func(PublishMessageRequest) error
}

func NewServer(socketPath string) (*Server, error) {
	_ = os.Remove(socketPath)

	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return nil, err
	}

	return &Server{
		listener: listener,
		log:      slog.With("component", "ipc"),
		statuses: make(map[string]StatusReport),
		services: make(map[string]*serviceClient),
	}, nil
}

func (s *Server) SetPublisher(publish func(PublishMessageRequest) error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.publish = publish
}

func (s *Server) Serve(ctx context.Context) {
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

func (s *Server) handleConnection(ctx context.Context, conn net.Conn) {
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

		var req Request
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

func (s *Server) handleRequest(client *serviceClient, req Request) Response {
	switch req.Method {
	case "register-service":
		var registerReq RegisterServiceRequest
		if err := json.Unmarshal(req.Params, &registerReq); err != nil {
			return Response{ID: req.ID, Error: &Error{Code: -1, Message: err.Error()}}
		}
		if registerReq.Service == "" {
			return Response{ID: req.ID, Error: &Error{Code: -3, Message: "service name is required"}}
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
			return Response{ID: req.ID, Error: &Error{Code: -1, Message: err.Error()}}
		}
		if publishReq.Subtopic == "" || publishReq.Type == "" {
			return Response{ID: req.ID, Error: &Error{Code: -4, Message: "subtopic and type are required"}}
		}
		if publishReq.Service == "" {
			publishReq.Service = client.serviceName()
		}

		s.mu.RLock()
		publisher := s.publish
		s.mu.RUnlock()
		if publisher == nil {
			return Response{ID: req.ID, Error: &Error{Code: -5, Message: "MQTT publisher is not ready"}}
		}
		if err := publisher(publishReq); err != nil {
			return Response{ID: req.ID, Error: &Error{Code: -6, Message: err.Error()}}
		}
		return okResponse(req.ID)

	case "send-service-message":
		var serviceReq SendServiceMessageRequest
		if err := json.Unmarshal(req.Params, &serviceReq); err != nil {
			return Response{ID: req.ID, Error: &Error{Code: -1, Message: err.Error()}}
		}
		if serviceReq.TargetService == "" || serviceReq.Subtopic == "" || serviceReq.Type == "" {
			return Response{ID: req.ID, Error: &Error{Code: -7, Message: "target_service, subtopic, and type are required"}}
		}
		if serviceReq.SourceService == "" {
			serviceReq.SourceService = client.serviceName()
		}

		if err := s.NotifyDirectService(serviceReq.TargetService, ServiceMessageNotification{
			SourceService: serviceReq.SourceService,
			TargetService: serviceReq.TargetService,
			Subtopic:      serviceReq.Subtopic,
			Envelope: MQTTEnvelope{
				MsgID:     fmt.Sprintf("%d", time.Now().UnixNano()),
				Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
				Type:      serviceReq.Type,
				Payload:   serviceReq.Payload,
			},
		}); err != nil {
			return Response{ID: req.ID, Error: &Error{Code: -8, Message: err.Error()}}
		}
		return okResponse(req.ID)

	case "report-status":
		var report StatusReport
		if err := json.Unmarshal(req.Params, &report); err != nil {
			return Response{ID: req.ID, Error: &Error{Code: -1, Message: err.Error()}}
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
			return Response{ID: req.ID, Error: &Error{Code: -1, Message: err.Error()}}
		}
		if report.Service == "" {
			report.Service = client.serviceName()
		}
		s.log.Error("error report from service", "service", report.Service, "error", report.Error, "fatal", report.Fatal)
		return okResponse(req.ID)

	default:
		return Response{ID: req.ID, Error: &Error{Code: -2, Message: "unknown method: " + req.Method}}
	}
}

func okResponse(id string) Response {
	result, _ := json.Marshal(map[string]bool{"ok": true})
	return Response{ID: id, Result: result}
}

func (s *Server) unregister(client *serviceClient) {
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

func (s *Server) NotifyService(service string, message MqttMessageNotification) error {
	params, err := json.Marshal(message)
	if err != nil {
		return err
	}

	return s.notify(service, Notification{
		Method: "mqtt-message",
		Params: params,
	})
}

func (s *Server) NotifyDirectService(service string, message ServiceMessageNotification) error {
	params, err := json.Marshal(message)
	if err != nil {
		return err
	}

	return s.notify(service, Notification{
		Method: "service-message",
		Params: params,
	})
}

func (s *Server) notify(service string, notification Notification) error {
	s.mu.RLock()
	client := s.services[service]
	s.mu.RUnlock()
	if client == nil {
		return fmt.Errorf("service %q is not registered", service)
	}
	return client.writeJSON(notification)
}

func (s *Server) GetStatuses() map[string]StatusReport {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make(map[string]StatusReport, len(s.statuses))
	for key, value := range s.statuses {
		out[key] = value
	}
	return out
}

func (s *Server) Close() {
	_ = s.listener.Close()
}
