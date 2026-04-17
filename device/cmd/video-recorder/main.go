package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/trakrai/device-services/internal/buildinfo"
	"github.com/trakrai/device-services/internal/shared/logging"
	"github.com/trakrai/device-services/internal/videorecorder"
)

func main() {
	configPath := flag.String("config", "config.json", "path to config file")
	version := flag.Bool("version", false, "print version information and exit")
	flag.Parse()

	if *version {
		if err := buildinfo.WriteVersion(os.Stdout, videorecorder.ServiceName); err != nil {
			slog.Error("write version failed", "error", err)
			os.Exit(1)
		}
		return
	}

	cfg, err := videorecorder.LoadConfig(*configPath)
	if err != nil {
		slog.Error("load config failed", "error", err)
		os.Exit(1)
	}

	logging.Configure(cfg.LogLevel)

	service, err := videorecorder.NewService(cfg)
	if err != nil {
		slog.Error("init video-recorder failed", "error", err)
		os.Exit(1)
	}
	defer service.Close()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	if err := service.Run(ctx); err != nil {
		slog.Error("video-recorder failed", "error", err)
		os.Exit(1)
	}

	slog.Info("video-recorder stopped")
}
