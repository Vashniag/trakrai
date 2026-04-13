package rtspfeeder

import (
	"context"
	"log/slog"
	"sync"

	"github.com/redis/go-redis/v9"

	"github.com/trakrai/device-services/internal/shared/redisconfig"
)

func Run(ctx context.Context, cfg *Config) error {
	GstInit()

	rdb := redis.NewClient(&redis.Options{
		Addr:     redisconfig.Address(cfg.Redis),
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
	})
	defer rdb.Close()

	if err := rdb.Ping(ctx).Err(); err != nil {
		return err
	}

	slog.Info("connected to redis", "host", cfg.Redis.Host, "port", cfg.Redis.Port)

	var wg sync.WaitGroup
	activeCameras := 0

	for _, camera := range cfg.Cameras {
		if !camera.Enabled {
			slog.Info("camera disabled, skipping", "name", camera.Name)
			continue
		}

		activeCameras++
		wg.Add(1)
		go func(camera CameraConfig) {
			defer wg.Done()
			RunFeeder(ctx, camera, cfg.Redis, rdb)
		}(camera)
	}

	if activeCameras == 0 {
		slog.Warn("no cameras enabled in config")
		return nil
	}

	slog.Info("rtsp-feeder started", "cameras", activeCameras)
	<-ctx.Done()
	slog.Info("rtsp-feeder shutting down")
	wg.Wait()
	slog.Info("all feeders stopped, exiting")
	return nil
}
