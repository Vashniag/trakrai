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

func (fs *FrameSource) ReadFrame(
	ctx context.Context,
	cameraName string,
	frameSource LiveFrameSource,
) ([]byte, string, error) {
	switch frameSource {
	case LiveFrameSourceProcessed:
		return fs.readProcessedFrame(ctx, cameraName)
	case LiveFrameSourceRaw:
		fallthrough
	default:
		return fs.readRawFrame(ctx, cameraName)
	}
}

func (fs *FrameSource) readRawFrame(ctx context.Context, cameraName string) ([]byte, string, error) {
	key := fmt.Sprintf("%s:%s:latest", fs.keyPrefix, cameraName)
	result, err := fs.rdb.HMGet(ctx, key, "raw", "imgID").Result()
	if err != nil {
		return nil, "", fmt.Errorf("redis hget: %w", err)
	}
	if len(result) < 2 || result[0] == nil {
		return nil, "", fmt.Errorf("no raw frame available for %s", cameraName)
	}

	frameData, err := coerceFrameBytes(result[0], "raw")
	if err != nil {
		return nil, "", err
	}

	imgID := ""
	if result[1] != nil {
		imgID = fmt.Sprint(result[1])
	}

	return frameData, imgID, nil
}

func (fs *FrameSource) readProcessedFrame(
	ctx context.Context,
	cameraName string,
) ([]byte, string, error) {
	key := fmt.Sprintf("%s:%s:processed", fs.keyPrefix, cameraName)
	timeKey := fmt.Sprintf("%s:%s:processed_time", fs.keyPrefix, cameraName)

	frameData, err := fs.rdb.Get(ctx, key).Bytes()
	if err != nil {
		if err == redis.Nil {
			return nil, "", fmt.Errorf("no processed frame available for %s", cameraName)
		}

		return nil, "", fmt.Errorf("redis get: %w", err)
	}

	imgID, err := fs.rdb.Get(ctx, timeKey).Result()
	if err != nil && err != redis.Nil {
		return nil, "", fmt.Errorf("redis get processed time: %w", err)
	}
	if err == redis.Nil {
		imgID = ""
	}

	return frameData, imgID, nil
}

func coerceFrameBytes(value interface{}, fieldName string) ([]byte, error) {
	switch frameValue := value.(type) {
	case string:
		return []byte(frameValue), nil
	case []byte:
		return frameValue, nil
	default:
		return nil, fmt.Errorf("unexpected type for %s field: %T", fieldName, value)
	}
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
			frame, imgID, err := fs.ReadFrame(ctx, cameraName, LiveFrameSourceRaw)
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
