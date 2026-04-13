package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/trakrai/device-services/internal/shared/logging"
	"github.com/trakrai/device-services/internal/workflowcomm"
)

func main() {
	configPath := flag.String("config", "config.json", "path to config file")
	flag.Parse()

	cfg, err := workflowcomm.LoadConfig(*configPath)
	if err != nil {
		slog.Error("load config failed", "error", err)
		os.Exit(1)
	}

	logging.Configure(cfg.LogLevel)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	service, err := workflowcomm.NewService(cfg)
	if err != nil {
		slog.Error("workflow-comm setup failed", "error", err)
		os.Exit(1)
	}
	defer service.Close()

	if err := service.Run(ctx); err != nil {
		slog.Error("workflow-comm failed", "error", err)
		os.Exit(1)
	}

	slog.Info("workflow-comm stopped")
}
