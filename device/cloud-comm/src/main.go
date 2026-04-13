package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"
)

var startTime = time.Now()

func main() {
	configPath := flag.String("config", "config.json", "path to config file")
	flag.Parse()

	cfg, err := LoadConfig(*configPath)
	if err != nil {
		slog.Error("load config failed", "error", err)
		os.Exit(1)
	}

	// Setup logger
	var level slog.Level
	switch cfg.LogLevel {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	default:
		level = slog.LevelInfo
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level})))

	slog.Info("trakrai cloud-comm starting",
		"device_id", cfg.DeviceID,
		"broker", cfg.MQTT.BrokerURL,
		"socket", cfg.IPC.SocketPath,
	)

	ipcServer, err := NewIPCServer(cfg.IPC.SocketPath)
	if err != nil {
		slog.Error("IPC server failed to start", "error", err)
		os.Exit(1)
	}
	defer ipcServer.Close()

	mqttSvc := NewMQTTService(cfg, ipcServer)
	ipcServer.SetPublisher(mqttSvc.Publish)

	if err := mqttSvc.Connect(); err != nil {
		slog.Error("mqtt connect failed", "error", err)
		os.Exit(1)
	}
	defer mqttSvc.Disconnect()

	// Context for shutdown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	stopCh := make(chan struct{})

	go ipcServer.Serve(ctx)
	slog.Info("IPC server started", "socket", cfg.IPC.SocketPath)

	go mqttSvc.StartHeartbeat(10*time.Second, stopCh)

	slog.Info("cloud-comm ready, waiting for MQTT and IPC traffic")

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	slog.Info("received signal, shutting down", "signal", sig)

	close(stopCh)
	cancel()

	slog.Info("cloud-comm stopped")
}
