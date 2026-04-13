package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/trakrai/device-services/internal/rtspfeeder"
	"github.com/trakrai/device-services/internal/shared/logging"
)

func main() {
	configPath := flag.String("config", "config.json", "path to config file")
	flag.Parse()

	cfg, err := rtspfeeder.LoadConfig(*configPath)
	if err != nil {
		slog.Error("load config failed", "error", err)
		os.Exit(1)
	}

	logging.Configure(cfg.LogLevel)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if err := rtspfeeder.Run(ctx, cfg); err != nil {
		slog.Error("rtsp-feeder failed", "error", err)
		os.Exit(1)
	}

	slog.Info("rtsp-feeder stopped")
}
