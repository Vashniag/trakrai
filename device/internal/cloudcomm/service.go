package cloudcomm

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/trakrai/device-services/internal/ipc"
)

type Service struct {
	cfg         *Config
	ipcServer   *ipc.Server
	mqttService *MQTTService
	edgeServer  *EdgeWebSocketServer
	publisher   *TransportPublisher
}

func NewService(cfg *Config) (*Service, error) {
	ipcServer, err := ipc.NewServer(cfg.IPC.SocketPath)
	if err != nil {
		return nil, err
	}

	service := &Service{
		cfg:       cfg,
		ipcServer: ipcServer,
	}

	mqttService := NewMQTTService(cfg, ipcServer, time.Now(), service.handleInbound)
	service.mqttService = mqttService

	if cfg.Edge.Enabled {
		service.edgeServer = NewEdgeWebSocketServer(cfg, service.handleInbound, mqttService.StatusEnvelope)
	}

	service.publisher = NewTransportPublisher(mqttService, service.edgeServer)
	ipcServer.SetPublisher(service.publisher.Publish)

	return service, nil
}

func (s *Service) Run(ctx context.Context) error {
	slog.Info("trakrai cloud-comm starting",
		"device_id", s.cfg.DeviceID,
		"broker", s.cfg.MQTT.BrokerURL,
		"socket", s.cfg.IPC.SocketPath,
	)

	if s.edgeServer != nil {
		if err := s.edgeServer.Start(ctx); err != nil {
			return err
		}
	}

	go s.ipcServer.Serve(ctx)
	s.mqttService.Start()
	go s.startHeartbeat(ctx, 10*time.Second)
	go s.mqttService.StartHealthMonitor(ctx, 15*time.Second)

	slog.Info("cloud-comm ready, waiting for MQTT and IPC traffic")
	<-ctx.Done()
	slog.Info("cloud-comm stopping")
	return nil
}

func (s *Service) handleInbound(route topicRoute, env ipc.MQTTEnvelope) error {
	if route.service == "" && route.subtopic == "command" && env.Type == "get-status" {
		return s.publisher.Publish(ipc.PublishMessageRequest{
			Subtopic: "response",
			Type:     "status",
			Payload:  s.mqttService.statusPayload(),
		})
	}

	if route.service == "" {
		if route.subtopic != "command" {
			return nil
		}

		publishErr := s.publisher.Publish(ipc.PublishMessageRequest{
			Subtopic: "response",
			Type:     "service-unavailable",
			Payload: marshalPayload(map[string]interface{}{
				"error":       "service is required for device command routing",
				"requestType": env.Type,
			}),
		})
		if publishErr != nil {
			return publishErr
		}
		return nil
	}

	if err := s.ipcServer.NotifyService(route.service, ipc.MqttMessageNotification{
		Service:  route.service,
		Subtopic: route.subtopic,
		Envelope: env,
	}); err != nil {
		if route.subtopic == "command" {
			publishErr := s.publisher.Publish(ipc.PublishMessageRequest{
				Service:  route.service,
				Subtopic: "response",
				Type:     "service-unavailable",
				Payload: marshalPayload(map[string]interface{}{
					"service":     route.service,
					"requestType": env.Type,
					"error":       err.Error(),
				}),
			})
			if publishErr != nil {
				return fmt.Errorf("%w (and publishing service-unavailable failed: %v)", err, publishErr)
			}
			return nil
		}

		return err
	}

	return nil
}

func (s *Service) startHeartbeat(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.publisher.Publish(ipc.PublishMessageRequest{
				Subtopic: "status",
				Type:     "heartbeat",
				Payload:  s.mqttService.heartbeatPayload(),
			}); err != nil {
				slog.Warn("heartbeat publish failed", "error", err)
			}
		}
	}
}

func (s *Service) Close() {
	if s.edgeServer != nil {
		s.edgeServer.Close()
	}
	s.mqttService.Disconnect()
	s.ipcServer.Close()
}
