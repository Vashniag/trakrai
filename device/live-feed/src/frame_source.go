package main

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
)

// FrameSource reads JPEG frames from Redis, written by the rtsp-feeder.
type FrameSource struct {
	rdb       *redis.Client
	keyPrefix string
	log       *slog.Logger
}

func NewFrameSource(cfg *Config) (*FrameSource, error) {
	addr := fmt.Sprintf("%s:%d", cfg.Redis.Host, cfg.Redis.Port)
	rdb := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis ping: %w", err)
	}

	return &FrameSource{
		rdb:       rdb,
		keyPrefix: cfg.Redis.KeyPrefix,
		log:       slog.With("component", "frame-source"),
	}, nil
}

// ReadFrame reads the latest JPEG frame for a camera from Redis.
// Returns the JPEG bytes and the frame timestamp.
func (fs *FrameSource) ReadFrame(ctx context.Context, cameraName string) ([]byte, string, error) {
	key := fmt.Sprintf("%s:%s:latest", fs.keyPrefix, cameraName)
	result, err := fs.rdb.HMGet(ctx, key, "raw", "imgID").Result()
	if err != nil {
		return nil, "", fmt.Errorf("redis hget: %w", err)
	}
	if len(result) < 2 || result[0] == nil {
		return nil, "", fmt.Errorf("no frame available for %s", cameraName)
	}

	// Redis go-redis returns []byte for binary data stored via HSet
	var frameData []byte
	switch v := result[0].(type) {
	case string:
		frameData = []byte(v)
	case []byte:
		frameData = v
	default:
		return nil, "", fmt.Errorf("unexpected type for raw field: %T", result[0])
	}

	imgID := ""
	if result[1] != nil {
		imgID = fmt.Sprint(result[1])
	}

	return frameData, imgID, nil
}

// FramePump continuously reads frames at the target FPS and sends them to a channel.
// It skips duplicate frames (same imgID).
func (fs *FrameSource) FramePump(ctx context.Context, cameraName string, fps int, frameCh chan<- []byte) {
	interval := time.Duration(float64(time.Second) / float64(fps))
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	lastImgID := ""
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			frame, imgID, err := fs.ReadFrame(ctx, cameraName)
			if err != nil {
				fs.log.Debug("frame read failed", "camera", cameraName, "error", err)
				continue
			}
			if imgID == lastImgID {
				continue // skip duplicate
			}
			lastImgID = imgID

			select {
			case frameCh <- frame:
			default:
				// drop frame if consumer is slow
			}
		}
	}
}

func (fs *FrameSource) Close() {
	fs.rdb.Close()
}
