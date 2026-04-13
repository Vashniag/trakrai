package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// RunFeeder is the main loop for a single camera. It tries each pipeline
// type in order, pulls JPEG frames via appsink, and publishes to Redis.
// It reconnects automatically on failure and respects context cancellation.
func RunFeeder(ctx context.Context, cam CameraConfig, redisCfg RedisConfig, rdb *redis.Client) {
	log := slog.With("camera", cam.Name, "id", cam.ID)
	log.Info("feeder starting",
		"rtsp_url", maskPassword(cam.RTSPURL),
		"method", cam.CaptureMethod,
		"resolution", fmt.Sprintf("%dx%d", cam.Width, cam.Height),
		"framerate", cam.Framerate,
		"rotate", cam.Rotate180,
	)

	redisKey := fmt.Sprintf("%s:%s:latest", redisCfg.KeyPrefix, cam.Name)
	ensureRedisHash(ctx, rdb, redisKey, log)

	minInterval := time.Duration(float64(time.Second) / cam.Framerate)
	pipelines := PipelineOrder(cam.CaptureMethod)

	for {
		if ctx.Err() != nil {
			log.Info("feeder stopped (context cancelled)")
			return
		}

		worked := false
		for _, pt := range pipelines {
			if ctx.Err() != nil {
				return
			}
			ok := runPipeline(ctx, cam, pt, rdb, redisKey, redisCfg, minInterval, log)
			if ok {
				worked = true
				break
			}
		}

		delay := time.Duration(cam.ReconnectDelaySec) * time.Second
		if !worked {
			log.Warn("all pipelines failed, retrying", "delay_sec", cam.ReconnectDelaySec)
		} else {
			log.Warn("pipeline stopped, reconnecting", "delay_sec", cam.ReconnectDelaySec)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
	}
}

// runPipeline creates the GStreamer pipeline in-process, pulls frames from
// appsink, and publishes to Redis. Returns true if at least one frame was
// captured (the pipeline "works" for this camera).
func runPipeline(
	ctx context.Context,
	cam CameraConfig,
	pt PipelineType,
	rdb *redis.Client,
	redisKey string,
	redisCfg RedisConfig,
	minInterval time.Duration,
	log *slog.Logger,
) bool {
	log = log.With("pipeline", pt.String())
	log.Info("trying pipeline")

	desc := BuildPipelineDesc(pt, cam)
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

	// Wait for first frame to validate the pipeline works.
	firstTimeout := uint64(cam.PipelineTimeout) * uint64(time.Second)
	frame, err := pipe.PullFrame(firstTimeout)
	if err != nil {
		log.Warn("no frames from pipeline", "timeout_sec", cam.PipelineTimeout, "error", err)
		return false
	}

	log.Info("pipeline active, first frame received", "size_bytes", len(frame))
	publishFrame(ctx, rdb, redisKey, cam, frame, log)
	if cam.SaveFrames {
		saveFrame(cam, frame, log)
	}

	lastPublish := time.Now()
	frameCount := int64(1)

	// 1-second pull timeout so we can check ctx.Done() between pulls.
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
			continue // rate limit
		}

		publishFrame(ctx, rdb, redisKey, cam, frame, log)
		if cam.SaveFrames {
			saveFrame(cam, frame, log)
		}
		lastPublish = now
		frameCount++
		if frameCount%100 == 0 {
			log.Info("frame milestone", "frames_total", frameCount)
		}
	}
}

func publishFrame(ctx context.Context, rdb *redis.Client, key string, cam CameraConfig, frame []byte, log *slog.Logger) {
	now := time.Now().Format("2006-01-02T15:04:05.000000")
	err := rdb.HSet(ctx, key, map[string]interface{}{
		"raw":    frame,
		"imgID":  now,
		"cam_id": cam.ID,
	}).Err()
	if err != nil {
		log.Error("redis publish failed", "error", err)
		return
	}
	log.Debug("frame published", "key", key, "size", len(frame), "ts", now)
}

func saveFrame(cam CameraConfig, frame []byte, log *slog.Logger) {
	today := time.Now().Format("2006-01-02")
	dir := filepath.Join(cam.SavePath, today)
	if err := os.MkdirAll(dir, 0755); err != nil {
		log.Error("create save dir failed", "error", err)
		return
	}
	fname := fmt.Sprintf("%s_%s.jpg", cam.Name, time.Now().Format("150405.000"))
	path := filepath.Join(dir, fname)
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
	if idx := strings.Index(url, "://"); idx >= 0 {
		rest := url[idx+3:]
		if atIdx := strings.Index(rest, "@"); atIdx >= 0 {
			if colonIdx := strings.Index(rest[:atIdx], ":"); colonIdx >= 0 {
				return url[:idx+3] + rest[:colonIdx+1] + "***@" + rest[atIdx+1:]
			}
		}
	}
	return url
}
