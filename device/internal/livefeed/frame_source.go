package livefeed

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/trakrai/device-services/internal/shared/redisconfig"
)

type FrameSource struct {
	rdb       *redis.Client
	keyPrefix string
	log       *slog.Logger
}

func NewFrameSource(cfg redisconfig.Config) (*FrameSource, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr:     redisconfig.Address(cfg),
		Password: cfg.Password,
		DB:       cfg.DB,
	})

	return &FrameSource{
		rdb:       rdb,
		keyPrefix: cfg.KeyPrefix,
		log:       slog.With("component", "frame-source"),
	}, nil
}

func (fs *FrameSource) ReadFrame(ctx context.Context, cameraName string) ([]byte, string, error) {
	key := fmt.Sprintf("%s:%s:latest", fs.keyPrefix, cameraName)
	result, err := fs.rdb.HMGet(ctx, key, "raw", "imgID").Result()
	if err != nil {
		return nil, "", fmt.Errorf("redis hget: %w", err)
	}
	if len(result) < 2 || result[0] == nil {
		return nil, "", fmt.Errorf("no frame available for %s", cameraName)
	}

	var frameData []byte
	switch value := result[0].(type) {
	case string:
		frameData = []byte(value)
	case []byte:
		frameData = value
	default:
		return nil, "", fmt.Errorf("unexpected type for raw field: %T", result[0])
	}

	imgID := ""
	if result[1] != nil {
		imgID = fmt.Sprint(result[1])
	}

	return frameData, imgID, nil
}

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
				continue
			}
			lastImgID = imgID

			select {
			case frameCh <- frame:
			default:
			}
		}
	}
}

func (fs *FrameSource) Close() {
	fs.rdb.Close()
}
