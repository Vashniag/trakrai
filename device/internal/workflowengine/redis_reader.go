package workflowengine

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

func popQueueEnvelope(
	ctx context.Context,
	redisClient redis.UniversalClient,
	cfg *Config,
) (*QueueEnvelope, error) {
	blockTimeout := time.Duration(cfg.Queue.BlockTimeoutSec) * time.Second
	result, err := redisClient.BRPop(ctx, blockTimeout, cfg.Queue.FrameQueueKey).Result()
	if err != nil {
		return nil, err
	}
	if len(result) != 2 {
		return nil, fmt.Errorf("unexpected BRPOP response length: %d", len(result))
	}

	return decodeQueueEnvelope(result[1], cfg)
}

func hydrateWorkflowFrame(
	ctx context.Context,
	redisClient redis.UniversalClient,
	frame *QueueEnvelope,
) (*WorkflowFrame, error) {
	detectionRaw := frame.DetectionsInline
	if len(detectionRaw) == 0 {
		if frame.DetectionsKey == "" {
			return nil, fmt.Errorf("detections key missing")
		}
		loaded, err := redisClient.Get(ctx, frame.DetectionsKey).Bytes()
		if err != nil {
			return nil, err
		}
		detectionRaw = loaded
	}

	detections, err := decodeDetectionDocument(detectionRaw)
	if err != nil {
		return nil, err
	}

	queueLatency := time.Duration(0)
	if !frame.EnqueuedAt.IsZero() {
		queueLatency = time.Since(frame.EnqueuedAt)
	}

	return &WorkflowFrame{
		Envelope:     *frame,
		Detections:   *detections,
		QueueLatency: queueLatency,
	}, nil
}
