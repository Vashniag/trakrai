package workflowcomm

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/trakrai/device-services/internal/shared/redisconfig"
)

type queueStats struct {
	Pending    int64
	Processing int64
	Retry      int64
	DeadLetter int64
}

type redisQueue struct {
	cfg *Config
	rdb *redis.Client
}

func newRedisQueue(cfg *Config) (*redisQueue, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr:     redisconfig.Address(cfg.Redis),
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
	})
	return &redisQueue{
		cfg: cfg,
		rdb: rdb,
	}, nil
}

func (q *redisQueue) Close() error {
	return q.rdb.Close()
}

func (q *redisQueue) Dequeue(ctx context.Context) (Job, string, error) {
	raw, err := q.rdb.BRPopLPush(
		ctx,
		q.cfg.Queue.PendingList,
		q.cfg.Queue.ProcessingList,
		time.Duration(q.cfg.Queue.PollTimeoutSec)*time.Second,
	).Result()
	if err != nil {
		if err == redis.Nil {
			return Job{}, "", nil
		}
		return Job{}, "", err
	}

	var job Job
	if err := json.Unmarshal([]byte(raw), &job); err != nil {
		return Job{}, raw, fmt.Errorf("parse queued job: %w", err)
	}
	return normalizeJob(job), raw, nil
}

func (q *redisQueue) Ack(ctx context.Context, raw string) error {
	return q.rdb.LRem(ctx, q.cfg.Queue.ProcessingList, 1, raw).Err()
}

func (q *redisQueue) Retry(ctx context.Context, raw string, job Job, delay time.Duration, reason string) error {
	job = normalizeJob(job)
	job.Attempt++
	job.LastError = reason
	updated, err := json.Marshal(job)
	if err != nil {
		return fmt.Errorf("marshal retry job: %w", err)
	}

	pipe := q.rdb.TxPipeline()
	pipe.LRem(ctx, q.cfg.Queue.ProcessingList, 1, raw)
	pipe.ZAdd(ctx, q.cfg.Queue.RetryZSet, redis.Z{
		Score:  float64(time.Now().Add(delay).Unix()),
		Member: string(updated),
	})
	_, err = pipe.Exec(ctx)
	return err
}

func (q *redisQueue) DeadLetter(ctx context.Context, raw string, job Job, reason string) error {
	job = normalizeJob(job)
	job.Attempt++
	job.LastError = reason
	updated, err := json.Marshal(job)
	if err != nil {
		return fmt.Errorf("marshal dead-letter job: %w", err)
	}

	pipe := q.rdb.TxPipeline()
	pipe.LRem(ctx, q.cfg.Queue.ProcessingList, 1, raw)
	pipe.LPush(ctx, q.cfg.Queue.DeadLetterList, string(updated))
	_, err = pipe.Exec(ctx)
	return err
}

func (q *redisQueue) DeadLetterRaw(ctx context.Context, raw string, reason string) error {
	payload, err := json.Marshal(map[string]any{
		"invalid_job": raw,
		"error":       reason,
		"failed_at":   time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		return err
	}

	pipe := q.rdb.TxPipeline()
	pipe.LRem(ctx, q.cfg.Queue.ProcessingList, 1, raw)
	pipe.LPush(ctx, q.cfg.Queue.DeadLetterList, string(payload))
	_, err = pipe.Exec(ctx)
	return err
}

func (q *redisQueue) PromoteDueRetries(ctx context.Context, limit int64) (int, error) {
	if limit <= 0 {
		limit = 50
	}

	items, err := q.rdb.ZRangeByScore(ctx, q.cfg.Queue.RetryZSet, &redis.ZRangeBy{
		Min:    "-inf",
		Max:    fmt.Sprintf("%d", time.Now().Unix()),
		Offset: 0,
		Count:  limit,
	}).Result()
	if err != nil {
		return 0, err
	}

	moved := 0
	for _, item := range items {
		pipe := q.rdb.TxPipeline()
		pipe.ZRem(ctx, q.cfg.Queue.RetryZSet, item)
		pipe.LPush(ctx, q.cfg.Queue.PendingList, item)
		if _, err := pipe.Exec(ctx); err != nil {
			return moved, err
		}
		moved++
	}

	return moved, nil
}

func (q *redisQueue) RequeueProcessing(ctx context.Context) error {
	items, err := q.rdb.LRange(ctx, q.cfg.Queue.ProcessingList, 0, -1).Result()
	if err != nil {
		return err
	}
	if len(items) == 0 {
		return nil
	}

	pipe := q.rdb.TxPipeline()
	for _, item := range items {
		pipe.LRem(ctx, q.cfg.Queue.ProcessingList, 1, item)
		pipe.ZAdd(ctx, q.cfg.Queue.RetryZSet, redis.Z{
			Score:  float64(time.Now().Unix()),
			Member: item,
		})
	}
	_, err = pipe.Exec(ctx)
	return err
}

func (q *redisQueue) Stats(ctx context.Context) (queueStats, error) {
	pipe := q.rdb.Pipeline()
	pendingCmd := pipe.LLen(ctx, q.cfg.Queue.PendingList)
	processingCmd := pipe.LLen(ctx, q.cfg.Queue.ProcessingList)
	retryCmd := pipe.ZCard(ctx, q.cfg.Queue.RetryZSet)
	deadCmd := pipe.LLen(ctx, q.cfg.Queue.DeadLetterList)
	if _, err := pipe.Exec(ctx); err != nil {
		return queueStats{}, err
	}
	return queueStats{
		Pending:    pendingCmd.Val(),
		Processing: processingCmd.Val(),
		Retry:      retryCmd.Val(),
		DeadLetter: deadCmd.Val(),
	}, nil
}
