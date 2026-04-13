package workflowcomm

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/trakrai/device-services/internal/ipc"
	"github.com/trakrai/device-services/internal/shared/redisconfig"
)

type serviceStats struct {
	State          string
	ProcessedJobs  int64
	RetriedJobs    int64
	DeadLetterJobs int64
	LastJobID      string
	LastError      string
	LastSuccessAt  string
}

type Service struct {
	cfg       *Config
	queue     *redisQueue
	processor *Processor
	ipcClient *ipc.Client
	log       *slog.Logger

	statsMu sync.Mutex
	stats   serviceStats
}

func NewService(cfg *Config) (*Service, error) {
	queue, err := newRedisQueue(cfg)
	if err != nil {
		return nil, err
	}

	return &Service{
		cfg:       cfg,
		queue:     queue,
		processor: NewProcessor(cfg),
		log:       slog.With("component", ServiceName),
		stats: serviceStats{
			State: "idle",
		},
	}, nil
}

func (s *Service) Run(ctx context.Context) error {
	s.log.Info("trakrai workflow-comm starting",
		"redis", redisconfig.Address(s.cfg.Redis),
		"pending_list", s.cfg.Queue.PendingList,
		"retry_zset", s.cfg.Queue.RetryZSet,
	)

	s.connectIPC(ctx)
	if err := s.queue.RequeueProcessing(ctx); err != nil {
		s.log.Warn("requeue processing jobs failed", "error", err)
	}

	s.reportStatus("idle")
	go s.retryLoop(ctx)
	go s.statusLoop(ctx)

	for {
		select {
		case <-ctx.Done():
			s.reportStatus("stopped")
			return nil
		default:
		}

		job, raw, err := s.queue.Dequeue(ctx)
		if err != nil {
			if ctx.Err() != nil {
				s.reportStatus("stopped")
				return nil
			}
			if raw != "" {
				s.log.Warn("invalid queued job, moving to dead-letter", "error", err)
				if deadErr := s.queue.DeadLetterRaw(ctx, raw, err.Error()); deadErr != nil {
					s.log.Warn("dead-letter invalid job failed", "error", deadErr)
				}
				s.recordDeadLetter("", err.Error())
			} else {
				s.log.Warn("dequeue failed", "error", err)
				s.recordError(err.Error())
			}
			time.Sleep(time.Second)
			continue
		}
		if raw == "" {
			continue
		}

		s.setState("processing", job.ID, "")
		result, err := s.processor.ProcessJob(ctx, job)
		if err == nil {
			if ackErr := s.queue.Ack(ctx, raw); ackErr != nil {
				s.log.Warn("ack failed", "job_id", job.ID, "error", ackErr)
				s.recordError(ackErr.Error())
				continue
			}
			s.log.Info("job processed",
				"job_id", job.ID,
				"job_type", job.Kind,
				"uploaded_files", len(result.UploadedFiles),
			)
			s.recordSuccess(job.ID)
			s.reportStatus("idle")
			continue
		}

		delay := computeBackoff(
			time.Duration(s.cfg.HTTP.InitialBackoffMs)*time.Millisecond,
			time.Duration(s.cfg.HTTP.MaxBackoffSec)*time.Second,
			job.Attempt,
		)
		if job.Attempt+1 >= job.effectiveMaxAttempts(s.cfg.Queue.MaxAttempts) {
			s.log.Error("job exhausted retries, moving to dead-letter", "job_id", job.ID, "error", err)
			if deadErr := s.queue.DeadLetter(ctx, raw, job, err.Error()); deadErr != nil {
				s.log.Warn("dead-letter failed", "job_id", job.ID, "error", deadErr)
			}
			s.recordDeadLetter(job.ID, err.Error())
			s.reportError(err)
			continue
		}

		s.log.Warn("job failed, scheduling retry",
			"job_id", job.ID,
			"attempt", job.Attempt+1,
			"retry_in", delay.String(),
			"error", err,
		)
		if retryErr := s.queue.Retry(ctx, raw, job, delay, err.Error()); retryErr != nil {
			s.log.Warn("schedule retry failed", "job_id", job.ID, "error", retryErr)
			s.recordError(retryErr.Error())
			continue
		}
		s.recordRetry(job.ID, err.Error())
		s.reportStatus("idle")
	}
}

func (s *Service) Close() {
	if s.ipcClient != nil {
		s.ipcClient.Close()
	}
	if err := s.queue.Close(); err != nil {
		s.log.Warn("redis close failed", "error", err)
	}
}

func (s *Service) retryLoop(ctx context.Context) {
	ticker := time.NewTicker(time.Duration(s.cfg.Queue.RetrySweepSec) * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			promoted, err := s.queue.PromoteDueRetries(ctx, 50)
			if err != nil {
				s.log.Warn("promote retries failed", "error", err)
				s.recordError(err.Error())
				continue
			}
			if promoted > 0 {
				s.log.Debug("promoted retry jobs", "count", promoted)
			}
		}
	}
}

func (s *Service) statusLoop(ctx context.Context) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.reportStatus(s.currentState())
		}
	}
}

func (s *Service) connectIPC(ctx context.Context) {
	socketPath := strings.TrimSpace(s.cfg.IPC.SocketPath)
	if socketPath == "" {
		return
	}

	client := ipc.NewClient(socketPath, ServiceName)
	if err := client.Connect(); err != nil {
		s.log.Warn("IPC unavailable, continuing without status reporting", "socket", socketPath, "error", err)
		return
	}

	s.ipcClient = client
	go s.drainNotifications(ctx, client)
}

func (s *Service) drainNotifications(ctx context.Context, client *ipc.Client) {
	for {
		select {
		case <-ctx.Done():
			return
		case notification, ok := <-client.Notifications():
			if !ok {
				return
			}
			if notification.Method == "" {
				continue
			}
			s.log.Debug("ignoring IPC notification", "method", notification.Method)
		}
	}
}

func (s *Service) reportStatus(state string) {
	if s.ipcClient == nil {
		return
	}
	timeoutCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	queueState, err := s.queue.Stats(timeoutCtx)
	if err != nil {
		s.log.Debug("queue stats failed", "error", err)
		queueState = queueStats{}
	}

	s.statsMu.Lock()
	stats := s.stats
	stats.State = state
	s.stats = stats
	s.statsMu.Unlock()

	details := map[string]any{
		"available":        true,
		"redis":            redisconfig.Address(s.cfg.Redis),
		"pendingJobs":      queueState.Pending,
		"processingJobs":   queueState.Processing,
		"retryJobs":        queueState.Retry,
		"deadLetterJobs":   queueState.DeadLetter,
		"processedJobs":    stats.ProcessedJobs,
		"retriedJobs":      stats.RetriedJobs,
		"deadLetteredJobs": stats.DeadLetterJobs,
		"lastJobId":        stats.LastJobID,
		"lastError":        stats.LastError,
		"lastSuccessAt":    stats.LastSuccessAt,
	}
	if err := s.ipcClient.ReportStatus(state, details); err != nil {
		s.log.Debug("status report failed", "error", err)
	}
}

func (s *Service) reportError(err error) {
	if s.ipcClient == nil || err == nil {
		return
	}
	if reportErr := s.ipcClient.ReportError(err.Error(), false); reportErr != nil {
		s.log.Debug("error report failed", "error", reportErr)
	}
}

func (s *Service) currentState() string {
	s.statsMu.Lock()
	defer s.statsMu.Unlock()
	if s.stats.State == "" {
		return "idle"
	}
	return s.stats.State
}

func (s *Service) setState(state string, jobID string, lastError string) {
	s.statsMu.Lock()
	defer s.statsMu.Unlock()
	s.stats.State = state
	if jobID != "" {
		s.stats.LastJobID = jobID
	}
	if lastError != "" {
		s.stats.LastError = lastError
	}
}

func (s *Service) recordSuccess(jobID string) {
	s.statsMu.Lock()
	defer s.statsMu.Unlock()
	s.stats.State = "idle"
	s.stats.ProcessedJobs++
	s.stats.LastJobID = jobID
	s.stats.LastError = ""
	s.stats.LastSuccessAt = time.Now().UTC().Format(time.RFC3339Nano)
}

func (s *Service) recordRetry(jobID string, lastError string) {
	s.statsMu.Lock()
	defer s.statsMu.Unlock()
	s.stats.State = "idle"
	s.stats.RetriedJobs++
	s.stats.LastJobID = jobID
	s.stats.LastError = lastError
}

func (s *Service) recordDeadLetter(jobID string, lastError string) {
	s.statsMu.Lock()
	defer s.statsMu.Unlock()
	s.stats.State = "idle"
	s.stats.DeadLetterJobs++
	if jobID != "" {
		s.stats.LastJobID = jobID
	}
	s.stats.LastError = lastError
}

func (s *Service) recordError(lastError string) {
	s.statsMu.Lock()
	defer s.statsMu.Unlock()
	s.stats.LastError = lastError
}

func (s *Service) MarshalJSON() ([]byte, error) {
	s.statsMu.Lock()
	defer s.statsMu.Unlock()
	return json.Marshal(s.stats)
}

func (s *Service) String() string {
	s.statsMu.Lock()
	defer s.statsMu.Unlock()
	return fmt.Sprintf(
		"state=%s processed=%d retried=%d dead=%d",
		s.stats.State,
		s.stats.ProcessedJobs,
		s.stats.RetriedJobs,
		s.stats.DeadLetterJobs,
	)
}
