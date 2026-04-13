package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/redis/go-redis/v9"
)

func main() {
	configPath := flag.String("config", "config.json", "Path to JSON config file")
	flag.Parse()

	cfg, err := LoadConfig(*configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}

	// Setup structured logging
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
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: level})))

	GstInit()

	// Connect to Redis
	rdb := redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf("%s:%d", cfg.Redis.Host, cfg.Redis.Port),
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		slog.Error("redis connection failed", "error", err)
		os.Exit(1)
	}
	slog.Info("connected to redis", "host", cfg.Redis.Host, "port", cfg.Redis.Port)

	// Start one goroutine per enabled camera
	var wg sync.WaitGroup
	active := 0
	for _, cam := range cfg.Cameras {
		if !cam.Enabled {
			slog.Info("camera disabled, skipping", "name", cam.Name)
			continue
		}
		active++
		wg.Add(1)
		go func(c CameraConfig) {
			defer wg.Done()
			RunFeeder(ctx, c, cfg.Redis, rdb)
		}(cam)
	}

	if active == 0 {
		slog.Warn("no cameras enabled in config")
		os.Exit(0)
	}
	slog.Info("rtsp-feeder started", "cameras", active)

	// Block until SIGINT or SIGTERM
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	slog.Info("shutting down", "signal", sig)
	cancel()
	wg.Wait()
	rdb.Close()
	slog.Info("all feeders stopped, exiting")
}
