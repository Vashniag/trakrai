package cloudcomm

import (
	"context"
	"log/slog"
	"time"

	"github.com/trakrai/device-services/internal/ipc"
)

type Service struct {
	cfg         *Config
	ipcServer   *ipc.Server
	mqttService *MQTTService
}

func NewService(cfg *Config) (*Service, error) {
	ipcServer, err := ipc.NewServer(cfg.IPC.SocketPath)
	if err != nil {
		return nil, err
	}

	mqttService := NewMQTTService(cfg, ipcServer, time.Now())
	ipcServer.SetPublisher(mqttService.Publish)

	return &Service{
		cfg:         cfg,
		ipcServer:   ipcServer,
		mqttService: mqttService,
	}, nil
}

func (s *Service) Run(ctx context.Context) error {
	slog.Info("trakrai cloud-comm starting",
		"device_id", s.cfg.DeviceID,
		"broker", s.cfg.MQTT.BrokerURL,
		"socket", s.cfg.IPC.SocketPath,
	)

	go s.ipcServer.Serve(ctx)
	s.mqttService.Start()
	go s.mqttService.StartHeartbeat(ctx, 10*time.Second)
	go s.mqttService.StartHealthMonitor(ctx, 15*time.Second)

	slog.Info("cloud-comm ready, waiting for MQTT and IPC traffic")
	<-ctx.Done()
	slog.Info("cloud-comm stopping")
	return nil
}

func (s *Service) Close() {
	s.mqttService.Disconnect()
	s.ipcServer.Close()
}
