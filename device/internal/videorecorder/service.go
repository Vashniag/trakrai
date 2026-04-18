package videorecorder

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/trakrai/device-services/internal/cloudtransfer"
	"github.com/trakrai/device-services/internal/gstcodec"
	"github.com/trakrai/device-services/internal/ipc"
	"github.com/trakrai/device-services/internal/ipc/contracts"
)

const (
	frameTimeLayout = "2006-01-02T15:04:05.000000"
)

type Service struct {
	cfg             *Config
	redis           *redis.Client
	ipcClient       *ipc.Client
	responseRouter  *ipc.ResponseRouter
	transferClient  *contracts.CloudTransferClient
	log             *slog.Logger
	writer          clipWriter
	cameraBuffers   map[string]*cameraBuffer
	cameraNamesByID map[string]string
	workQueue       chan queuedJob

	jobsMu sync.RWMutex
	jobs   map[string]RecordingJob
	order  []string

	statsMu sync.RWMutex
	stats   RecorderStats
}

func NewService(cfg *Config) (*Service, error) {
	if _, err := exec.LookPath(cfg.Recording.GStreamerBin); err != nil {
		return nil, fmt.Errorf("recording.gstreamer_bin %q is unavailable: %w", cfg.Recording.GStreamerBin, err)
	}

	cameraBuffers := make(map[string]*cameraBuffer, len(cfg.Cameras))
	cameraNamesByID := make(map[string]string, len(cfg.Cameras))
	for _, camera := range cfg.Cameras {
		if !camera.Enabled {
			continue
		}
		buffer, err := newCameraBuffer(
			camera,
			cfg.Storage.BufferDir,
			time.Duration(cfg.Buffer.DurationSec)*time.Second,
			cfg.Buffer.MaxBytesPerCamera,
			cfg.Buffer.MaxFramesPerCamera,
			int64(cfg.Buffer.MaxSegmentBytes),
		)
		if err != nil {
			return nil, fmt.Errorf("create camera buffer for %s: %w", camera.Name, err)
		}
		cameraBuffers[camera.Name] = buffer
		cameraNamesByID[camera.ID] = camera.Name
	}
	if len(cameraBuffers) == 0 {
		return nil, fmt.Errorf("at least one enabled camera is required")
	}

	ipcClient := ipc.NewClient(cfg.IPC.SocketPath, ServiceName)
	responseRouter := ipc.NewResponseRouter()

	return &Service{
		cfg: cfg,
		redis: redis.NewClient(&redis.Options{
			Addr:     redisconfigAddress(cfg),
			DB:       cfg.Redis.DB,
			Password: cfg.Redis.Password,
		}),
		ipcClient:       ipcClient,
		responseRouter:  responseRouter,
		transferClient:  contracts.NewCloudTransferClient(ipcClient, responseRouter, cfg.Upload.ServiceName),
		log:             slog.With("component", ServiceName),
		writer:          newClipWriter(cfg.Recording.GStreamerBin, slog.With("component", "video-recorder-writer")),
		cameraBuffers:   cameraBuffers,
		cameraNamesByID: cameraNamesByID,
		workQueue:       make(chan queuedJob, cfg.Queue.MaxPending),
		jobs:            make(map[string]RecordingJob),
		order:           make([]string, 0, cfg.Queue.MaxPending),
	}, nil
}

func (s *Service) Close() {
	for _, buffer := range s.cameraBuffers {
		buffer.close()
	}
	s.ipcClient.Close()
	_ = s.redis.Close()
}

func (s *Service) Run(ctx context.Context) error {
	if err := os.MkdirAll(s.cfg.Storage.SharedDir, 0o755); err != nil {
		return fmt.Errorf("create shared dir: %w", err)
	}
	if err := os.MkdirAll(s.cfg.Storage.BufferDir, 0o755); err != nil {
		return fmt.Errorf("create video buffer dir: %w", err)
	}
	if err := s.redis.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("connect redis: %w", err)
	}

	s.ipcClient.Start()
	if err := s.reportStatus("running"); err != nil {
		s.log.Debug("initial video-recorder status report failed", "error", err)
	}

	go s.collectLoop(ctx)
	for workerID := 0; workerID < s.cfg.Queue.WorkerCount; workerID++ {
		go s.workerLoop(ctx, workerID+1)
	}
	go s.statusLoop(ctx)
	go s.handleNotifications(ctx)

	s.log.Info(
		"video-recorder ready",
		"device_id", s.cfg.DeviceID,
		"camera_count", len(s.cameraBuffers),
		"shared_dir", s.cfg.Storage.SharedDir,
	)

	<-ctx.Done()
	if err := s.reportStatus("stopped"); err != nil {
		s.log.Debug("final video-recorder status report failed", "error", err)
	}
	return nil
}

func (s *Service) collectLoop(ctx context.Context) {
	ticker := time.NewTicker(time.Duration(s.cfg.Buffer.PollIntervalMs) * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.collectLatestFrames(ctx)
		}
	}
}

func (s *Service) collectLatestFrames(ctx context.Context) {
	pipe := s.redis.Pipeline()
	buffers := make([]*cameraBuffer, 0, len(s.cameraBuffers))
	for _, name := range sortedCameraNames(s.cameraBuffers) {
		buffer := s.cameraBuffers[name]
		buffers = append(buffers, buffer)
		key := s.cameraKey(buffer.camera.Name)
		pipe.HMGet(ctx, key, "raw", "imgID")
	}

	results, err := pipe.Exec(ctx)
	if err != nil && !errors.Is(err, redis.Nil) {
		s.log.Warn("collect latest frames failed", "error", err)
		return
	}

	for index, commandResult := range results {
		buffer := buffers[index]
		values, hmgetErr := commandResult.(*redis.SliceCmd).Result()
		if hmgetErr != nil && !errors.Is(hmgetErr, redis.Nil) {
			s.log.Warn("read latest frame failed", "camera", buffer.camera.Name, "error", hmgetErr)
			continue
		}
		if len(values) < 2 {
			continue
		}
		rawFrame, rawOK := toBytes(values[0])
		imageID := toString(values[1])
		if !rawOK || imageID == "" {
			continue
		}
		timestamp := parseFrameTime(imageID)
		if timestamp.IsZero() {
			timestamp = time.Now()
		}
		if _, addErr := buffer.addFrame(imageID, timestamp, rawFrame); addErr != nil {
			s.log.Warn("buffer frame append failed", "camera", buffer.camera.Name, "error", addErr)
		}
	}
}

func (s *Service) workerLoop(ctx context.Context, workerID int) {
	for {
		select {
		case <-ctx.Done():
			return
		case queued := <-s.workQueue:
			s.processJob(ctx, queued.job, workerID)
		}
	}
}

func (s *Service) statusLoop(ctx context.Context) {
	ticker := time.NewTicker(time.Duration(s.cfg.Buffer.StatusReportIntervalSec) * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.reportStatus("running"); err != nil {
				s.log.Debug("periodic video-recorder status report failed", "error", err)
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
					s.log.Warn("invalid video-recorder MQTT notification", "error", err)
					continue
				}
				s.handleCommand(ctx, "", message.Subtopic, message.Envelope)
			case "service-message":
				var message ipc.ServiceMessageNotification
				if err := json.Unmarshal(notification.Params, &message); err != nil {
					s.log.Warn("invalid video-recorder service notification", "error", err)
					continue
				}
				if strings.TrimSpace(message.Subtopic) == "response" && s.responseRouter.Dispatch(message) {
					continue
				}
				s.handleCommand(ctx, message.SourceService, message.Subtopic, message.Envelope)
			}
		}
	}
}

func (s *Service) handleCommand(ctx context.Context, sourceService string, subtopic string, env ipc.MQTTEnvelope) {
	handled, err := contracts.DispatchVideoRecorder(ctx, sourceService, subtopic, env, s)
	if err != nil {
		s.publishError(sourceService, ipc.ReadRequestID(env.Payload), env.Type, err)
		return
	}
	if !handled && strings.TrimSpace(subtopic) == contracts.VideoRecorderCapturePhotoSubtopic {
		s.publishError(sourceService, ipc.ReadRequestID(env.Payload), env.Type, fmt.Errorf("unsupported video-recorder command %q", env.Type))
	}
}

func (s *Service) HandleCapturePhoto(_ context.Context, sourceService string, request contracts.VideoRecorderCapturePhotoRequest) error {
	cameraBuffer, err := s.resolveCameraBuffer(request.CameraId, request.CameraName)
	if err != nil {
		s.publishError(sourceService, request.RequestId, contracts.VideoRecorderCapturePhotoMethod, err)
		return nil
	}
	relativePath, absolutePath, err := resolveSharedPath(s.cfg.Storage.SharedDir, request.LocalPath)
	if err != nil {
		s.publishError(sourceService, request.RequestId, contracts.VideoRecorderCapturePhotoMethod, err)
		return nil
	}

	targetTime := parseFrameTime(request.ImageId)
	var frame frameEntry
	var found bool
	if !targetTime.IsZero() {
		frame, found, err = cameraBuffer.nearestFrame(targetTime)
	} else {
		frame, found, err = cameraBuffer.latestFrame()
	}
	if err != nil {
		s.publishError(sourceService, request.RequestId, contracts.VideoRecorderCapturePhotoMethod, fmt.Errorf("load buffered frame: %w", err))
		return nil
	}
	if !found {
		s.publishError(sourceService, request.RequestId, contracts.VideoRecorderCapturePhotoMethod, fmt.Errorf("no buffered frame is available for %s", cameraBuffer.camera.Name))
		return nil
	}

	if err := os.MkdirAll(filepath.Dir(absolutePath), 0o755); err != nil {
		s.publishError(sourceService, request.RequestId, contracts.VideoRecorderCapturePhotoMethod, fmt.Errorf("create photo directory: %w", err))
		return nil
	}
	if err := os.WriteFile(absolutePath, frame.jpeg, 0o644); err != nil {
		s.publishError(sourceService, request.RequestId, contracts.VideoRecorderCapturePhotoMethod, fmt.Errorf("write captured photo: %w", err))
		return nil
	}

	payload := RecorderPhotoPayload{
		RequestID: strings.TrimSpace(request.RequestId),
		Photo: PhotoCapture{
			Bytes:      len(frame.jpeg),
			CameraID:   cameraBuffer.camera.ID,
			CameraName: cameraBuffer.camera.Name,
			CapturedAt: frame.timestamp.UTC(),
			ImageID:    frame.imageID,
			LocalPath:  relativePath,
		},
	}
	if err := s.publishReply(sourceService, contracts.VideoRecorderPhotoMessage, payload); err != nil {
		s.log.Warn("publish video-recorder photo response failed", "error", err)
	}
	return nil
}

func (s *Service) HandleRecordClip(_ context.Context, sourceService string, request contracts.VideoRecorderRecordClipRequest) error {
	cameraBuffer, err := s.resolveCameraBuffer(request.CameraId, request.CameraName)
	if err != nil {
		s.publishError(sourceService, request.RequestId, contracts.VideoRecorderRecordClipMethod, err)
		return nil
	}
	relativePath, _, err := resolveSharedPath(s.cfg.Storage.SharedDir, request.LocalPath)
	if err != nil {
		s.publishError(sourceService, request.RequestId, contracts.VideoRecorderRecordClipMethod, err)
		return nil
	}
	if strings.TrimSpace(request.RemotePath) == "" {
		s.publishError(sourceService, request.RequestId, contracts.VideoRecorderRecordClipMethod, fmt.Errorf("remotePath is required"))
		return nil
	}

	frameRate := request.FrameRate
	if frameRate <= 0 {
		frameRate = s.cfg.Recording.DefaultFrameRate
	}
	if frameRate > s.cfg.Recording.MaxFrameRate {
		frameRate = s.cfg.Recording.MaxFrameRate
	}
	preSeconds := request.PreSeconds
	if preSeconds < 0 {
		preSeconds = float64(s.cfg.Recording.DefaultPreSec)
	}
	postSeconds := request.PostSeconds
	if postSeconds < 0 {
		postSeconds = float64(s.cfg.Recording.DefaultPostSec)
	}
	contentType := strings.TrimSpace(request.ContentType)
	if contentType == "" {
		contentType = "video/mp4"
	}
	codec := string(gstcodec.NormalizeVideoCodec(request.Codec))
	if strings.TrimSpace(request.Codec) == "" {
		codec = s.cfg.Recording.DefaultCodec
	}
	scope := cloudtransfer.StorageScope(request.Scope)
	if scope == "" {
		scope = cloudtransfer.ScopeDevice
	}

	eventTime := parseFrameTime(request.ImageId)
	if eventTime.IsZero() {
		eventTime = time.Now()
	}

	now := time.Now().UTC()
	job := RecordingJob{
		CameraID:    cameraBuffer.camera.ID,
		CameraName:  cameraBuffer.camera.Name,
		Codec:       codec,
		ContentType: contentType,
		CreatedAt:   now,
		EventAt:     eventTime.UTC(),
		FrameRate:   frameRate,
		ID:          uuid.NewString(),
		ImageID:     strings.TrimSpace(request.ImageId),
		LocalPath:   relativePath,
		Metadata:    cloneMetadata(request.Metadata),
		PostSeconds: postSeconds,
		PreSeconds:  preSeconds,
		RemotePath:  strings.TrimSpace(request.RemotePath),
		Scope:       scope,
		State:       JobStateQueued,
		Timeout:     strings.TrimSpace(request.Timeout),
		UpdatedAt:   now,
	}

	if !s.enqueueJob(job) {
		s.publishError(sourceService, request.RequestId, contracts.VideoRecorderRecordClipMethod, fmt.Errorf("video-recorder queue is full"))
		return nil
	}

	if err := s.publishReply(sourceService, contracts.VideoRecorderJobMessage, RecorderJobPayload{
		RequestID: strings.TrimSpace(request.RequestId),
		Job:       job,
	}); err != nil {
		s.log.Warn("publish video-recorder job response failed", "error", err)
	}
	return nil
}

func (s *Service) HandleGetJob(_ context.Context, sourceService string, request contracts.VideoRecorderGetJobRequest) error {
	if strings.TrimSpace(request.JobId) == "" {
		s.publishError(sourceService, request.RequestId, contracts.VideoRecorderGetJobMethod, fmt.Errorf("jobId is required"))
		return nil
	}
	job, ok := s.getJob(request.JobId)
	if !ok {
		s.publishError(sourceService, request.RequestId, contracts.VideoRecorderGetJobMethod, fmt.Errorf("job %q was not found", request.JobId))
		return nil
	}
	if err := s.publishReply(sourceService, contracts.VideoRecorderJobMessage, RecorderJobPayload{
		RequestID: strings.TrimSpace(request.RequestId),
		Job:       job,
	}); err != nil {
		s.log.Warn("publish video-recorder get-job response failed", "error", err)
	}
	return nil
}

func (s *Service) HandleListJobs(_ context.Context, sourceService string, request contracts.VideoRecorderListJobsRequest) error {
	if request.Limit <= 0 {
		request.Limit = 20
	}
	if err := s.publishReply(sourceService, contracts.VideoRecorderListMessage, RecorderListPayload{
		RequestID: strings.TrimSpace(request.RequestId),
		Items:     s.listJobs(request.Limit),
	}); err != nil {
		s.log.Warn("publish video-recorder list response failed", "error", err)
	}
	return nil
}

func (s *Service) HandleGetStatus(_ context.Context, sourceService string, request contracts.VideoRecorderRequestEnvelope) error {
	if err := s.publishReply(sourceService, contracts.VideoRecorderStatusMessage, s.buildStatusPayload(strings.TrimSpace(request.RequestId))); err != nil {
		s.log.Warn("publish video-recorder status response failed", "error", err)
	}
	return nil
}

func (s *Service) processJob(ctx context.Context, job RecordingJob, workerID int) {
	startedAt := time.Now().UTC()
	job.StartedAt = &startedAt
	job.State = JobStateWaitingBuffer
	job.UpdatedAt = startedAt
	s.storeJob(job)
	s.updateStatsForRunning()

	defer s.finishRunningJob(job.ID)

	cameraBuffer, err := s.resolveCameraBuffer(job.CameraID, job.CameraName)
	if err != nil {
		s.failJob(job, err)
		return
	}

	clipEnd := job.EventAt.Add(time.Duration(job.PostSeconds * float64(time.Second)))
	for time.Now().Before(clipEnd) {
		if ctx.Err() != nil {
			s.failJob(job, ctx.Err())
			return
		}
		time.Sleep(100 * time.Millisecond)
	}

	frames := cameraBuffer.snapshotRange(
		job.EventAt.Add(-time.Duration(job.PreSeconds*float64(time.Second))),
		clipEnd,
	)
	if len(frames) == 0 {
		s.failJob(job, fmt.Errorf("no buffered frames are available for clip window"))
		return
	}

	selectedFrames := selectFramesForClip(frames, job.EventAt, job.PreSeconds, job.PostSeconds, job.FrameRate)
	if len(selectedFrames) == 0 {
		s.failJob(job, fmt.Errorf("no frames were selected for clip encoding"))
		return
	}
	selectedEntries, err := cameraBuffer.loadFrames(selectedFrames)
	if err != nil {
		s.failJob(job, fmt.Errorf("load selected clip frames: %w", err))
		return
	}
	selectedJPEGs := make([][]byte, 0, len(selectedEntries))
	for _, entry := range selectedEntries {
		selectedJPEGs = append(selectedJPEGs, entry.jpeg)
	}

	_, absolutePath, err := resolveSharedPath(s.cfg.Storage.SharedDir, job.LocalPath)
	if err != nil {
		s.failJob(job, err)
		return
	}

	job.State = JobStateEncoding
	job.FrameCount = len(selectedFrames)
	job.UpdatedAt = time.Now().UTC()
	s.storeJob(job)

	writeCtx, cancel := context.WithTimeout(ctx, time.Duration(s.cfg.Recording.WriteTimeoutSec)*time.Second)
	err = s.writer.WriteJPEGSequence(
		writeCtx,
		absolutePath,
		cameraBuffer.camera.Width,
		cameraBuffer.camera.Height,
		job.FrameRate,
		gstcodec.NormalizeVideoCodec(job.Codec),
		selectedJPEGs,
	)
	cancel()
	if err != nil {
		s.failJob(job, err)
		return
	}

	job.State = JobStateUploading
	job.UpdatedAt = time.Now().UTC()
	s.storeJob(job)

	transfer, err := s.enqueueVideoUpload(ctx, job, workerID)
	if err != nil {
		s.failJob(job, err)
		return
	}
	job.TransferID = transfer.Id
	job.UpdatedAt = time.Now().UTC()
	s.storeJob(job)

	finalTransfer, err := s.waitForTransferCompletion(ctx, transfer.Id)
	if err != nil {
		s.failJob(job, err)
		return
	}
	job.TransferID = finalTransfer.Id
	completedAt := time.Now().UTC()
	job.CompletedAt = &completedAt
	job.State = JobStateCompleted
	job.UpdatedAt = completedAt
	s.storeJob(job)
	s.incrementCompleted()
}

func (s *Service) enqueueVideoUpload(ctx context.Context, job RecordingJob, workerID int) (contracts.CloudTransferTransfer, error) {
	response, err := s.transferClient.EnqueueUpload(
		ctx,
		contracts.CloudTransferEnqueueUploadRequest{
			ContentType: job.ContentType,
			LocalPath:   job.LocalPath,
			Metadata:    cloneMetadata(job.Metadata),
			RemotePath:  job.RemotePath,
			RequestId:   fmt.Sprintf("video-upload-%s", uuid.NewString()),
			Scope:       string(job.Scope),
			Timeout:     job.Timeout,
		},
	)
	if err != nil {
		return contracts.CloudTransferTransfer{}, err
	}
	transfer := response.Transfer
	s.log.Info("video upload enqueued", "job_id", job.ID, "transfer_id", transfer.Id, "worker", workerID)
	return transfer, nil
}

func (s *Service) waitForTransferCompletion(ctx context.Context, transferID string) (contracts.CloudTransferTransfer, error) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for {
		response, err := s.transferClient.GetTransfer(
			ctx,
			contracts.CloudTransferGetTransferRequest{
				RequestId:  fmt.Sprintf("video-upload-poll-%s", uuid.NewString()),
				TransferId: transferID,
			},
		)
		if err != nil {
			return contracts.CloudTransferTransfer{}, err
		}
		transfer := response.Transfer
		switch transfer.State {
		case string(cloudtransfer.StateCompleted):
			return transfer, nil
		case string(cloudtransfer.StateFailed):
			return contracts.CloudTransferTransfer{}, fmt.Errorf("video upload failed: %s", transfer.LastError)
		}

		select {
		case <-ctx.Done():
			return contracts.CloudTransferTransfer{}, ctx.Err()
		case <-ticker.C:
		}
	}
}

func (s *Service) resolveCameraBuffer(cameraID string, cameraName string) (*cameraBuffer, error) {
	cameraID = strings.TrimSpace(cameraID)
	cameraName = strings.TrimSpace(cameraName)
	if cameraName == "" && cameraID != "" {
		cameraName = s.cameraNamesByID[cameraID]
	}
	if cameraName == "" {
		return nil, fmt.Errorf("cameraName or cameraId is required")
	}
	buffer := s.cameraBuffers[cameraName]
	if buffer == nil {
		return nil, fmt.Errorf("camera %q is not configured for video recording", cameraName)
	}
	return buffer, nil
}

func (s *Service) enqueueJob(job RecordingJob) bool {
	s.jobsMu.Lock()
	if len(s.workQueue) >= cap(s.workQueue) {
		s.jobsMu.Unlock()
		return false
	}
	s.jobs[job.ID] = job
	s.order = append(s.order, job.ID)
	s.jobsMu.Unlock()

	s.statsMu.Lock()
	s.stats.TotalJobs++
	s.stats.PendingJobs++
	s.statsMu.Unlock()

	select {
	case s.workQueue <- queuedJob{job: job}:
		return true
	default:
		s.jobsMu.Lock()
		delete(s.jobs, job.ID)
		s.jobsMu.Unlock()
		s.statsMu.Lock()
		s.stats.TotalJobs--
		s.stats.PendingJobs--
		s.statsMu.Unlock()
		return false
	}
}

func (s *Service) storeJob(job RecordingJob) {
	s.jobsMu.Lock()
	defer s.jobsMu.Unlock()
	s.jobs[job.ID] = job
}

func (s *Service) failJob(job RecordingJob, err error) {
	now := time.Now().UTC()
	job.State = JobStateFailed
	job.Error = err.Error()
	job.UpdatedAt = now
	s.storeJob(job)

	s.statsMu.Lock()
	s.stats.FailedJobs++
	s.statsMu.Unlock()

	s.log.Warn("video-recorder job failed", "job_id", job.ID, "error", err)
}

func (s *Service) incrementCompleted() {
	s.statsMu.Lock()
	s.stats.CompletedJobs++
	s.statsMu.Unlock()
}

func (s *Service) updateStatsForRunning() {
	s.statsMu.Lock()
	if s.stats.PendingJobs > 0 {
		s.stats.PendingJobs--
	}
	s.stats.RunningJobs++
	s.statsMu.Unlock()
}

func (s *Service) finishRunningJob(jobID string) {
	s.statsMu.Lock()
	if s.stats.RunningJobs > 0 {
		s.stats.RunningJobs--
	}
	s.statsMu.Unlock()
	_ = jobID
}

func (s *Service) getJob(jobID string) (RecordingJob, bool) {
	s.jobsMu.RLock()
	defer s.jobsMu.RUnlock()
	job, ok := s.jobs[jobID]
	return job, ok
}

func (s *Service) listJobs(limit int) []RecordingJob {
	s.jobsMu.RLock()
	defer s.jobsMu.RUnlock()

	if limit <= 0 {
		limit = len(s.order)
	}
	items := make([]RecordingJob, 0, limit)
	for index := len(s.order) - 1; index >= 0 && len(items) < limit; index-- {
		job, ok := s.jobs[s.order[index]]
		if !ok {
			continue
		}
		items = append(items, job)
	}
	return items
}

func (s *Service) buildStatusPayload(requestID string) RecorderStatusPayload {
	bufferStatuses := make([]CameraBufferStatus, 0, len(s.cameraBuffers))
	for _, name := range sortedCameraNames(s.cameraBuffers) {
		bufferStatuses = append(bufferStatuses, s.cameraBuffers[name].status())
	}

	s.statsMu.RLock()
	stats := s.stats
	s.statsMu.RUnlock()

	return RecorderStatusPayload{
		Buffers:   bufferStatuses,
		DeviceID:  s.cfg.DeviceID,
		GStreamer: s.cfg.Recording.GStreamerBin,
		RequestID: requestID,
		SharedDir: s.cfg.Storage.SharedDir,
		Stats:     stats,
	}
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

	payload := RecorderErrorPayload{
		Error:       err.Error(),
		RequestID:   strings.TrimSpace(requestID),
		RequestType: strings.TrimSpace(requestType),
	}
	if publishErr := s.publishReply(targetService, videoRecorderErrorType, payload); publishErr != nil {
		s.log.Warn("publish video-recorder error failed", "error", publishErr)
	}
	if reportErr := s.ipcClient.ReportError(payload.Error, false); reportErr != nil {
		s.log.Debug("video-recorder error report failed", "error", reportErr)
	}
}

func (s *Service) reportStatus(status string) error {
	payload := s.buildStatusPayload("")
	return s.ipcClient.ReportStatus(status, map[string]interface{}{
		"buffers":   payload.Buffers,
		"deviceId":  payload.DeviceID,
		"gstreamer": payload.GStreamer,
		"sharedDir": payload.SharedDir,
		"stats":     payload.Stats,
	})
}

func (s *Service) cameraKey(cameraName string) string {
	return fmt.Sprintf("%s:%s:latest", s.cfg.Redis.KeyPrefix, cameraName)
}

func resolveSharedPath(sharedDir string, localPath string) (string, string, error) {
	sharedRoot, err := filepath.Abs(sharedDir)
	if err != nil {
		return "", "", fmt.Errorf("resolve shared dir: %w", err)
	}

	cleaned := strings.TrimSpace(filepath.ToSlash(localPath))
	if cleaned == "" {
		return "", "", fmt.Errorf("localPath is required")
	}

	var absolutePath string
	if filepath.IsAbs(cleaned) {
		absolutePath = filepath.Clean(cleaned)
	} else {
		absolutePath = filepath.Join(sharedRoot, filepath.FromSlash(cleaned))
	}
	absolutePath = filepath.Clean(absolutePath)
	relativePath, err := filepath.Rel(sharedRoot, absolutePath)
	if err != nil {
		return "", "", fmt.Errorf("resolve localPath: %w", err)
	}
	if relativePath == "." || strings.HasPrefix(relativePath, "..") {
		return "", "", fmt.Errorf("localPath must stay inside shared_dir")
	}
	return filepath.ToSlash(relativePath), absolutePath, nil
}

func parseFrameTime(imageID string) time.Time {
	imageID = strings.TrimSpace(imageID)
	if imageID == "" {
		return time.Time{}
	}
	if parsed, err := time.ParseInLocation(frameTimeLayout, imageID, time.Local); err == nil {
		return parsed
	}
	if parsed, err := time.Parse(time.RFC3339Nano, imageID); err == nil {
		return parsed
	}
	return time.Time{}
}

func selectFramesForClip(
	frames []bufferedFrame,
	eventAt time.Time,
	preSeconds float64,
	postSeconds float64,
	fps int,
) []bufferedFrame {
	if len(frames) == 0 || fps <= 0 {
		return nil
	}

	sort.Slice(frames, func(left int, right int) bool {
		return frames[left].timestamp.Before(frames[right].timestamp)
	})

	clipStart := eventAt.Add(-time.Duration(preSeconds * float64(time.Second)))
	clipEnd := eventAt.Add(time.Duration(postSeconds * float64(time.Second)))
	if !clipEnd.After(clipStart) {
		clipEnd = clipStart.Add(time.Second / time.Duration(fps))
	}

	step := time.Second / time.Duration(fps)
	selected := make([]bufferedFrame, 0, int(clipEnd.Sub(clipStart)/step)+2)
	frameIndex := 0
	lastFrame := frames[0]

	for target := clipStart; !target.After(clipEnd); target = target.Add(step) {
		for frameIndex+1 < len(frames) && !frames[frameIndex+1].timestamp.After(target) {
			frameIndex++
			lastFrame = frames[frameIndex]
		}
		selected = append(selected, lastFrame)
	}
	if len(selected) == 0 {
		selected = append(selected, frames[len(frames)-1])
	}
	return selected
}

func toBytes(value interface{}) ([]byte, bool) {
	switch typed := value.(type) {
	case string:
		return []byte(typed), true
	case []byte:
		return append([]byte(nil), typed...), true
	default:
		return nil, false
	}
}

func toString(value interface{}) string {
	if value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case []byte:
		return strings.TrimSpace(string(typed))
	default:
		return strings.TrimSpace(fmt.Sprint(value))
	}
}

func sortedCameraNames(buffers map[string]*cameraBuffer) []string {
	names := make([]string, 0, len(buffers))
	for name := range buffers {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func cloneMetadata(metadata map[string]string) map[string]string {
	if len(metadata) == 0 {
		return map[string]string{}
	}
	cloned := make(map[string]string, len(metadata))
	for key, value := range metadata {
		cloned[key] = value
	}
	return cloned
}

func redisconfigAddress(cfg *Config) string {
	return fmt.Sprintf("%s:%d", cfg.Redis.Host, cfg.Redis.Port)
}
