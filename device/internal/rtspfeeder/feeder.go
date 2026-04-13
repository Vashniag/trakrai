package rtspfeeder

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/trakrai/device-services/internal/shared/redisconfig"
)

func RunFeeder(ctx context.Context, camera CameraConfig, redisCfg redisconfig.Config, rdb *redis.Client) {
	log := slog.With("camera", camera.Name, "id", camera.ID)
	log.Info("feeder starting",
		"rtsp_url", maskPassword(camera.RTSPURL),
		"method", camera.CaptureMethod,
		"resolution", fmt.Sprintf("%dx%d", camera.Width, camera.Height),
		"framerate", camera.Framerate,
		"rotate", camera.Rotate180,
	)

	redisKey := fmt.Sprintf("%s:%s:latest", redisCfg.KeyPrefix, camera.Name)
	ensureRedisHash(ctx, rdb, redisKey, log)

	minInterval := time.Duration(float64(time.Second) / camera.Framerate)
	pipelines := PipelineOrder(camera.CaptureMethod)

	for {
		if ctx.Err() != nil {
			log.Info("feeder stopped (context cancelled)")
			return
		}

		worked := false
		for _, pipelineType := range pipelines {
			if ctx.Err() != nil {
				return
			}
			ok := runPipeline(ctx, camera, pipelineType, rdb, redisKey, minInterval, log)
			if ok {
				worked = true
				break
			}
		}

		delay := time.Duration(camera.ReconnectDelaySec) * time.Second
		if !worked {
			log.Warn("all pipelines failed, retrying", "delay_sec", camera.ReconnectDelaySec)
		} else {
			log.Warn("pipeline stopped, reconnecting", "delay_sec", camera.ReconnectDelaySec)
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
	}
}

func runPipeline(
	ctx context.Context,
	camera CameraConfig,
	pipelineType PipelineType,
	rdb *redis.Client,
	redisKey string,
	minInterval time.Duration,
	log *slog.Logger,
) bool {
	log = log.With("pipeline", pipelineType.String())
	log.Info("trying pipeline")

	desc := BuildPipelineDesc(pipelineType, camera)
	if desc == "" {
		return false
	}

	pipe, err := NewPipeline(desc)
	if err != nil {
		log.Warn("pipeline create failed", "error", err)
		return false
	}
	defer pipe.Stop()

	if err := pipe.Start(); err != nil {
		log.Warn("pipeline start failed", "error", err)
		return false
	}

	firstTimeout := uint64(camera.PipelineTimeout) * uint64(time.Second)
	frame, err := pipe.PullFrame(firstTimeout)
	if err != nil {
		log.Warn("no frames from pipeline", "timeout_sec", camera.PipelineTimeout, "error", err)
		return false
	}

	log.Info("pipeline active, first frame received", "size_bytes", len(frame))
	publishFrame(ctx, rdb, redisKey, camera, frame, log)
	if camera.SaveFrames {
		saveFrame(camera, frame, log)
	}

	lastPublish := time.Now()
	frameCount := int64(1)
	pullTimeout := uint64(time.Second)

	for {
		if ctx.Err() != nil {
			log.Info("pipeline stopped (shutdown)", "frames_total", frameCount)
			return true
		}

		frame, err := pipe.PullFrame(pullTimeout)
		if err != nil {
			if ctx.Err() != nil {
				log.Info("pipeline stopped (shutdown)", "frames_total", frameCount)
				return true
			}
			log.Warn("pipeline ended", "frames_total", frameCount, "error", err)
			return true
		}

		now := time.Now()
		if now.Sub(lastPublish) < minInterval {
			continue
		}

		publishFrame(ctx, rdb, redisKey, camera, frame, log)
		if camera.SaveFrames {
			saveFrame(camera, frame, log)
		}
		lastPublish = now
		frameCount++
		if frameCount%100 == 0 {
			log.Info("frame milestone", "frames_total", frameCount)
		}
	}
}

func publishFrame(
	ctx context.Context,
	rdb *redis.Client,
	key string,
	camera CameraConfig,
	frame []byte,
	log *slog.Logger,
) {
	now := time.Now().Format("2006-01-02T15:04:05.000000")
	err := rdb.HSet(ctx, key, map[string]interface{}{
		"raw":    frame,
		"imgID":  now,
		"cam_id": camera.ID,
	}).Err()
	if err != nil {
		log.Error("redis publish failed", "error", err)
		return
	}
	log.Debug("frame published", "key", key, "size", len(frame), "ts", now)
}

func saveFrame(camera CameraConfig, frame []byte, log *slog.Logger) {
	today := time.Now().Format("2006-01-02")
	dir := filepath.Join(camera.SavePath, today)
	if err := os.MkdirAll(dir, 0755); err != nil {
		log.Error("create save dir failed", "error", err)
		return
	}
	fileName := fmt.Sprintf("%s_%s.jpg", camera.Name, time.Now().Format("150405.000"))
	path := filepath.Join(dir, fileName)
	if err := os.WriteFile(path, frame, 0644); err != nil {
		log.Error("save frame failed", "error", err)
	}
}

func ensureRedisHash(ctx context.Context, rdb *redis.Client, key string, log *slog.Logger) {
	keyType, err := rdb.Type(ctx, key).Result()
	if err != nil {
		return
	}
	if keyType != "hash" && keyType != "none" {
		log.Warn("redis key is not a hash, deleting", "key", key, "type", keyType)
		rdb.Del(ctx, key)
	}
}

func maskPassword(url string) string {
	if index := strings.Index(url, "://"); index >= 0 {
		rest := url[index+3:]
		if atIndex := strings.Index(rest, "@"); atIndex >= 0 {
			if colonIndex := strings.Index(rest[:atIndex], ":"); colonIndex >= 0 {
				return url[:index+3] + rest[:colonIndex+1] + "***@" + rest[atIndex+1:]
			}
		}
	}
	return url
}
