package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/trakrai/device-services/internal/buildinfo"
	"github.com/trakrai/device-services/internal/roiconfig"
	"github.com/trakrai/device-services/internal/shared/logging"
)

func main() {
	configPath := flag.String("config", "config.json", "path to config file")
	version := flag.Bool("version", false, "print version information and exit")
	flag.Parse()

	if *version {
		if err := buildinfo.WriteVersion(os.Stdout, roiconfig.ServiceName); err != nil {
			slog.Error("write version failed", "error", err)
			os.Exit(1)
		}
		return
	}

	cfg, err := roiconfig.LoadConfig(*configPath)
	if err != nil {
		slog.Error("load config failed", "error", err)
		os.Exit(1)
	}

	logging.Configure(cfg.LogLevel)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	service := roiconfig.NewService(cfg)
	defer service.Close()

	if err := service.Run(ctx); err != nil {
		slog.Error("roi-config failed", "error", err)
		os.Exit(1)
	}

	slog.Info("roi-config stopped")
}
