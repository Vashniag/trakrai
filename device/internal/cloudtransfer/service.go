package cloudtransfer

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/trakrai/device-services/internal/ipc"
)

const (
	cloudTransferErrorType    = "cloud-transfer-error"
	cloudTransferListType     = "cloud-transfer-list"
	cloudTransferStatsType    = "cloud-transfer-stats"
	cloudTransferStatusType   = "cloud-transfer-status"
	cloudTransferTransferType = "cloud-transfer-transfer"
)

type Service struct {
	cfg        *Config
	cloudAPI   *cloudAPIClient
	httpClient *http.Client
	ipcClient  *ipc.Client
	log        *slog.Logger
	store      *Store

	workSignal chan struct{}
}

func NewService(cfg *Config) (*Service, error) {
	store, err := OpenStore(cfg.Storage.DatabasePath)
	if err != nil {
		return nil, err
	}

	service := &Service{
		cfg:      cfg,
		cloudAPI: newCloudAPIClient(cfg),
		httpClient: &http.Client{
			Timeout: time.Duration(cfg.CloudAPI.RequestTimeoutSec) * time.Second,
		},
		ipcClient:  ipc.NewClient(cfg.IPC.SocketPath, ServiceName),
		log:        slog.With("component", ServiceName),
		store:      store,
		workSignal: make(chan struct{}, cfg.Queue.WorkerCount+1),
	}
	return service, nil
}

func (s *Service) Close() {
	s.ipcClient.Close()
	if s.store != nil {
		_ = s.store.Close()
	}
}

func (s *Service) Run(ctx context.Context) error {
	if err := os.MkdirAll(s.cfg.Storage.SharedDir, 0o755); err != nil {
		return fmt.Errorf("create shared dir: %w", err)
	}
	if err := s.store.ResetRunningTransfers(ctx, time.Now().UTC()); err != nil {
		return err
	}
	if err := s.store.MarkExpired(ctx, time.Now().UTC()); err != nil {
		return err
	}

	s.ipcClient.Start()
	if err := s.reportCurrentStatus(ctx, "running"); err != nil {
		s.log.Debug("initial cloud-transfer status report failed", "error", err)
	}

	for index := 0; index < s.cfg.Queue.WorkerCount; index++ {
		go s.workerLoop(ctx, index+1)
	}
	go s.statusLoop(ctx)
	go s.handleNotifications(ctx)

	s.log.Info(
		"cloud-transfer ready",
		"device_id", s.cfg.DeviceID,
		"shared_dir", s.cfg.Storage.SharedDir,
		"database_path", s.cfg.Storage.DatabasePath,
		"worker_count", s.cfg.Queue.WorkerCount,
	)

	<-ctx.Done()
	if err := s.reportCurrentStatus(context.Background(), "stopped"); err != nil {
		s.log.Debug("final cloud-transfer status report failed", "error", err)
	}
	return nil
}

func (s *Service) workerLoop(ctx context.Context, workerID int) {
	pollInterval := time.Duration(s.cfg.Queue.PollIntervalMs) * time.Millisecond
	timer := time.NewTimer(0)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		case <-s.workSignal:
		}

		now := time.Now().UTC()
		if err := s.store.MarkExpired(ctx, now); err != nil {
			s.log.Warn("mark expired transfers failed", "error", err)
		}

		transfer, err := s.store.AcquireDueTransfer(ctx, now)
		if err != nil {
			s.log.Warn("claim transfer failed", "error", err, "worker", workerID)
			timer.Reset(pollInterval)
			continue
		}
		if transfer == nil {
			timer.Reset(pollInterval)
			continue
		}

		if err := s.processTransfer(ctx, *transfer); err != nil {
			s.log.Warn(
				"transfer processing failed",
				"error", err,
				"worker", workerID,
				"transfer_id", transfer.ID,
				"direction", transfer.Direction,
				"remote_path", transfer.RemotePath,
			)
		}
		timer.Reset(0)
	}
}

func (s *Service) processTransfer(ctx context.Context, transfer Transfer) error {
	now := time.Now().UTC()
	if transfer.DeadlineAt != nil && !transfer.DeadlineAt.After(now) {
		if err := s.store.MarkFailed(ctx, transfer.ID, "transfer deadline expired before processing started", now); err != nil {
			return err
		}
		s.signalWork()
		_ = s.reportCurrentStatus(ctx, "running")
		return nil
	}

	var (
		err       error
		objectKey string
	)
	switch transfer.Direction {
	case DirectionUpload:
		objectKey, err = s.handleUpload(ctx, transfer)
	case DirectionDownload:
		objectKey, err = s.handleDownload(ctx, transfer)
	default:
		err = fmt.Errorf("unsupported transfer direction %q", transfer.Direction)
	}

	if err == nil {
		if err := s.store.MarkCompleted(ctx, transfer.ID, objectKey, time.Now().UTC()); err != nil {
			return err
		}
		_ = s.reportCurrentStatus(ctx, "running")
		s.signalWork()
		return nil
	}

	failureTime := time.Now().UTC()
	permanent := !isTemporaryError(err)
	if transfer.DeadlineAt != nil {
		nextAttempt := s.nextAttemptTime(transfer.Attempts, failureTime)
		if !transfer.DeadlineAt.After(nextAttempt) {
			permanent = true
		}
	}
	if permanent {
		if err := s.store.MarkFailed(ctx, transfer.ID, err.Error(), failureTime); err != nil {
			return err
		}
		_ = s.reportCurrentStatus(ctx, "running")
		s.signalWork()
		return nil
	}

	nextAttempt := s.nextAttemptTime(transfer.Attempts, failureTime)
	if err := s.store.MarkRetry(ctx, transfer.ID, nextAttempt, err.Error(), objectKey, failureTime); err != nil {
		return err
	}
	_ = s.reportCurrentStatus(ctx, "running")
	s.signalWork()
	return nil
}

func (s *Service) handleUpload(ctx context.Context, transfer Transfer) (string, error) {
	if _, err := os.Stat(transfer.LocalPath); err != nil {
		return transfer.ObjectKey, &temporaryError{message: fmt.Sprintf("upload source %s is not ready: %v", transfer.LocalPath, err)}
	}
	presigned, err := s.cloudAPI.PresignUpload(ctx, transfer.RemotePath, transfer.ContentType)
	if err != nil {
		return transfer.ObjectKey, err
	}
	return performPresignedUpload(ctx, s.httpClient, presigned, transfer.LocalPath, transfer.ContentType)
}

func (s *Service) handleDownload(ctx context.Context, transfer Transfer) (string, error) {
	presigned, err := s.cloudAPI.PresignDownload(ctx, transfer.RemotePath)
	if err != nil {
		return transfer.ObjectKey, err
	}
	return performPresignedDownload(ctx, s.httpClient, presigned, transfer.LocalPath)
}

func (s *Service) nextAttemptTime(attempts int, now time.Time) time.Time {
	if attempts < 1 {
		attempts = 1
	}
	backoff := float64(s.cfg.Queue.InitialBackoffSec) * math.Pow(2, float64(attempts-1))
	if maxBackoff := float64(s.cfg.Queue.MaxBackoffSec); backoff > maxBackoff {
		backoff = maxBackoff
	}
	return now.Add(time.Duration(backoff) * time.Second)
}

func (s *Service) statusLoop(ctx context.Context) {
	ticker := time.NewTicker(time.Duration(s.cfg.Queue.StatusReportIntervalSec) * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.reportCurrentStatus(ctx, "running"); err != nil {
				s.log.Debug("periodic cloud-transfer status report failed", "error", err)
			}
		}
	}
}

func (s *Service) handleNotifications(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case notification, ok := <-s.ipcClient.Notifications():
			if !ok {
				return
			}

			switch notification.Method {
			case "mqtt-message":
				var message ipc.MqttMessageNotification
				if err := json.Unmarshal(notification.Params, &message); err != nil {
					s.log.Warn("invalid cloud-transfer MQTT notification", "error", err)
					continue
				}
				if strings.TrimSpace(message.Subtopic) != "command" {
					continue
				}
				s.handleCommand(ctx, "", message.Envelope)

			case "service-message":
				var message ipc.ServiceMessageNotification
				if err := json.Unmarshal(notification.Params, &message); err != nil {
					s.log.Warn("invalid cloud-transfer service notification", "error", err)
					continue
				}
				if strings.TrimSpace(message.Subtopic) != "command" {
					continue
				}
				s.handleCommand(ctx, message.SourceService, message.Envelope)
			}
		}
	}
}

func (s *Service) handleCommand(ctx context.Context, sourceService string, env ipc.MQTTEnvelope) {
	switch strings.TrimSpace(env.Type) {
	case "enqueue-upload":
		s.handleEnqueueUpload(ctx, sourceService, env)
	case "enqueue-download":
		s.handleEnqueueDownload(ctx, sourceService, env)
	case "get-stats":
		s.handleGetStats(ctx, sourceService, env)
	case "get-status":
		s.handleGetStatus(ctx, sourceService, env)
	case "get-transfer":
		s.handleGetTransfer(ctx, sourceService, env)
	case "list-transfers":
		s.handleListTransfers(ctx, sourceService, env)
	default:
		s.publishError(sourceService, envelopeRequestID(env), env.Type, fmt.Errorf("unsupported cloud-transfer command %q", env.Type))
	}
}

func (s *Service) handleEnqueueUpload(ctx context.Context, sourceService string, env ipc.MQTTEnvelope) {
	var request EnqueueUploadRequest
	if err := json.Unmarshal(env.Payload, &request); err != nil {
		s.publishError(sourceService, "", env.Type, fmt.Errorf("invalid enqueue-upload payload: %w", err))
		return
	}

	transfer, err := s.enqueueUpload(ctx, request)
	if err != nil {
		s.publishError(sourceService, request.RequestID, env.Type, err)
		return
	}
	if err := s.publishReply(sourceService, cloudTransferTransferType, TransferPayload{
		RequestID: request.RequestID,
		Transfer:  transfer,
	}); err != nil {
		s.log.Warn("publish cloud-transfer upload enqueue response failed", "error", err)
	}
}

func (s *Service) handleEnqueueDownload(ctx context.Context, sourceService string, env ipc.MQTTEnvelope) {
	var request EnqueueDownloadRequest
	if err := json.Unmarshal(env.Payload, &request); err != nil {
		s.publishError(sourceService, "", env.Type, fmt.Errorf("invalid enqueue-download payload: %w", err))
		return
	}

	transfer, err := s.enqueueDownload(ctx, request)
	if err != nil {
		s.publishError(sourceService, request.RequestID, env.Type, err)
		return
	}
	if err := s.publishReply(sourceService, cloudTransferTransferType, TransferPayload{
		RequestID: request.RequestID,
		Transfer:  transfer,
	}); err != nil {
		s.log.Warn("publish cloud-transfer download enqueue response failed", "error", err)
	}
}

func (s *Service) handleGetTransfer(ctx context.Context, sourceService string, env ipc.MQTTEnvelope) {
	var request GetTransferRequest
	if err := json.Unmarshal(env.Payload, &request); err != nil {
		s.publishError(sourceService, "", env.Type, fmt.Errorf("invalid get-transfer payload: %w", err))
		return
	}

	transferID := strings.TrimSpace(request.TransferID)
	if transferID == "" {
		s.publishError(sourceService, request.RequestID, env.Type, badRequestError{err: fmt.Errorf("transferId is required")})
		return
	}

	transfer, err := s.store.GetTransfer(ctx, transferID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			err = badRequestError{err: fmt.Errorf("transfer %q was not found", transferID)}
		}
		s.publishError(sourceService, request.RequestID, env.Type, err)
		return
	}

	if err := s.publishReply(sourceService, cloudTransferTransferType, TransferPayload{
		RequestID: request.RequestID,
		Transfer:  transfer,
	}); err != nil {
		s.log.Warn("publish cloud-transfer get-transfer response failed", "error", err)
	}
}

func (s *Service) handleListTransfers(ctx context.Context, sourceService string, env ipc.MQTTEnvelope) {
	var request ListTransfersRequest
	if len(env.Payload) > 0 {
		if err := json.Unmarshal(env.Payload, &request); err != nil {
			s.publishError(sourceService, "", env.Type, fmt.Errorf("invalid list-transfers payload: %w", err))
			return
		}
	}

	items, err := s.store.ListTransfers(ctx, listFilter{
		Direction: request.Direction,
		Limit:     request.Limit,
		State:     request.State,
	})
	if err != nil {
		s.publishError(sourceService, request.RequestID, env.Type, err)
		return
	}

	if err := s.publishReply(sourceService, cloudTransferListType, TransferListPayload{
		Items:     items,
		RequestID: request.RequestID,
	}); err != nil {
		s.log.Warn("publish cloud-transfer list response failed", "error", err)
	}
}

func (s *Service) handleGetStats(ctx context.Context, sourceService string, env ipc.MQTTEnvelope) {
	var request StatsRequest
	if len(env.Payload) > 0 {
		if err := json.Unmarshal(env.Payload, &request); err != nil {
			s.publishError(sourceService, "", env.Type, fmt.Errorf("invalid get-stats payload: %w", err))
			return
		}
	}

	stats, err := s.store.Stats(ctx)
	if err != nil {
		s.publishError(sourceService, request.RequestID, env.Type, err)
		return
	}
	if err := s.publishReply(sourceService, cloudTransferStatsType, TransferStatsPayload{
		RequestID: request.RequestID,
		Stats:     stats,
	}); err != nil {
		s.log.Warn("publish cloud-transfer stats response failed", "error", err)
	}
}

func (s *Service) handleGetStatus(ctx context.Context, sourceService string, env ipc.MQTTEnvelope) {
	requestID := envelopeRequestID(env)
	if err := s.publishStatusResponse(ctx, sourceService, requestID); err != nil {
		s.log.Warn("publish cloud-transfer status response failed", "error", err)
	}
}

func (s *Service) publishStatusResponse(ctx context.Context, sourceService string, requestID string) error {
	stats, err := s.store.Stats(ctx)
	if err != nil {
		return err
	}
	return s.publishReply(sourceService, cloudTransferStatusType, TransferStatusPayload{
		DatabasePath: s.cfg.Storage.DatabasePath,
		DeviceID:     s.cfg.DeviceID,
		RequestID:    strings.TrimSpace(requestID),
		SharedDir:    s.cfg.Storage.SharedDir,
		Stats:        stats,
	})
}

func (s *Service) publishReply(targetService string, messageType string, payload interface{}) error {
	targetService = strings.TrimSpace(targetService)
	if targetService != "" {
		return s.ipcClient.SendServiceMessage(targetService, "response", messageType, payload)
	}
	return s.ipcClient.Publish("response", messageType, payload)
}

func (s *Service) publishError(targetService string, requestID string, requestType string, err error) {
	if err == nil {
		return
	}

	payload := TransferErrorPayload{
		Error:       err.Error(),
		RequestID:   strings.TrimSpace(requestID),
		RequestType: strings.TrimSpace(requestType),
	}
	if publishErr := s.publishReply(targetService, cloudTransferErrorType, payload); publishErr != nil {
		s.log.Warn("publish cloud-transfer error failed", "error", publishErr)
	}
	if reportErr := s.ipcClient.ReportError(payload.Error, false); reportErr != nil {
		s.log.Debug("cloud-transfer error report failed", "error", reportErr)
	}
}

func (s *Service) reportCurrentStatus(ctx context.Context, status string) error {
	stats, err := s.store.Stats(ctx)
	if err != nil {
		return err
	}
	return s.ipcClient.ReportStatus(status, map[string]interface{}{
		"database":  s.cfg.Storage.DatabasePath,
		"deviceId":  s.cfg.DeviceID,
		"sharedDir": s.cfg.Storage.SharedDir,
		"stats":     stats,
	})
}

func (s *Service) enqueueUpload(ctx context.Context, request EnqueueUploadRequest) (Transfer, error) {
	now := time.Now().UTC()
	remotePath, err := normalizeRemotePath(request.RemotePath)
	if err != nil {
		return Transfer{}, badRequestError{err: err}
	}
	localPath, err := normalizeSharedPath(s.cfg.Storage.SharedDir, request.LocalPath)
	if err != nil {
		return Transfer{}, badRequestError{err: err}
	}
	info, err := os.Stat(localPath)
	if err != nil {
		return Transfer{}, badRequestError{err: fmt.Errorf("upload localPath is not ready: %w", err)}
	}
	if info.IsDir() {
		return Transfer{}, badRequestError{err: fmt.Errorf("upload localPath must be a file")}
	}
	deadline, err := parseTimeoutWindow(request.Timeout, now)
	if err != nil {
		return Transfer{}, badRequestError{err: err}
	}

	transfer := Transfer{
		Attempts:      0,
		ContentType:   strings.TrimSpace(request.ContentType),
		CreatedAt:     now,
		DeadlineAt:    deadline,
		DeviceID:      s.cfg.DeviceID,
		Direction:     DirectionUpload,
		ID:            uuid.NewString(),
		LocalPath:     localPath,
		Metadata:      request.Metadata,
		NextAttemptAt: &now,
		RemotePath:    remotePath,
		State:         StateQueued,
		UpdatedAt:     now,
	}
	enqueued, err := s.store.Enqueue(ctx, transfer)
	if err != nil {
		return Transfer{}, err
	}
	s.signalWork()
	_ = s.reportCurrentStatus(ctx, "running")
	return enqueued, nil
}

func (s *Service) enqueueDownload(ctx context.Context, request EnqueueDownloadRequest) (Transfer, error) {
	now := time.Now().UTC()
	remotePath, err := normalizeRemotePath(request.RemotePath)
	if err != nil {
		return Transfer{}, badRequestError{err: err}
	}
	localPath, err := normalizeSharedPath(s.cfg.Storage.SharedDir, request.LocalPath)
	if err != nil {
		return Transfer{}, badRequestError{err: err}
	}
	deadline, err := parseTimeoutWindow(request.Timeout, now)
	if err != nil {
		return Transfer{}, badRequestError{err: err}
	}

	transfer := Transfer{
		Attempts:      0,
		CreatedAt:     now,
		DeadlineAt:    deadline,
		DeviceID:      s.cfg.DeviceID,
		Direction:     DirectionDownload,
		ID:            uuid.NewString(),
		LocalPath:     localPath,
		Metadata:      request.Metadata,
		NextAttemptAt: &now,
		RemotePath:    remotePath,
		State:         StateQueued,
		UpdatedAt:     now,
	}
	enqueued, err := s.store.Enqueue(ctx, transfer)
	if err != nil {
		return Transfer{}, err
	}
	s.signalWork()
	_ = s.reportCurrentStatus(ctx, "running")
	return enqueued, nil
}

func (s *Service) signalWork() {
	select {
	case s.workSignal <- struct{}{}:
	default:
	}
}

func envelopeRequestID(env ipc.MQTTEnvelope) string {
	if len(env.Payload) == 0 {
		return ""
	}

	var decoded map[string]interface{}
	if err := json.Unmarshal(env.Payload, &decoded); err != nil || decoded == nil {
		return ""
	}

	requestID, _ := decoded["requestId"].(string)
	return strings.TrimSpace(requestID)
}

type badRequestError struct {
	err error
}

func (e badRequestError) Error() string {
	return e.err.Error()
}

func (e badRequestError) Unwrap() error {
	return e.err
}

func isBadRequest(err error) bool {
	var target badRequestError
	return errors.As(err, &target)
}
