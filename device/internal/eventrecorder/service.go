package eventrecorder

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/trakrai/device-services/internal/ipc"
	"github.com/trakrai/device-services/internal/livefeed"
	"github.com/trakrai/device-services/internal/shared/redisconfig"
)

type Service struct {
	cfg           *Config
	frameSrc      *livefeed.FrameSource
	ipcClient     *ipc.Client
	log           *slog.Logger
	samples       map[livefeed.LiveFrameSource]*frameStore
	storesMu      sync.RWMutex
	workflowRedis *redis.Client
	writer        *clipWriter
}

func NewService(cfg *Config) (*Service, error) {
	livefeed.GstInit()

	var frameSrc *livefeed.FrameSource
	if cfg.Sampling.Backend == "redis" {
		var err error
		frameSrc, err = livefeed.NewFrameSource(cfg.Redis)
		if err != nil {
			return nil, err
		}
	}

	sampleSources := resolveSampleSources(cfg.Sampling.FrameSource)
	maxFrames := cfg.Sampling.SampleFPS * cfg.Sampling.MaxBufferSec
	stores := make(map[livefeed.LiveFrameSource]*frameStore, len(sampleSources))
	for _, source := range sampleSources {
		stores[source] = newFrameStore(cfg.Cameras, maxFrames)
	}

	var workflowRedis *redis.Client
	if cfg.WorkflowQueue.Enabled {
		workflowRedis = redis.NewClient(&redis.Options{
			Addr:     redisconfig.Address(cfg.WorkflowQueue.Redis),
			Password: cfg.WorkflowQueue.Redis.Password,
			DB:       cfg.WorkflowQueue.Redis.DB,
		})
	}

	return &Service{
		cfg:           cfg,
		frameSrc:      frameSrc,
		ipcClient:     ipc.NewClient(cfg.IPC.SocketPath, ServiceName),
		log:           slog.With("component", ServiceName),
		samples:       stores,
		workflowRedis: workflowRedis,
		writer:        newClipWriter(cfg),
	}, nil
}

func (s *Service) Run(ctx context.Context) error {
	s.ipcClient.Start()
	defer s.ipcClient.Close()
	if s.frameSrc != nil {
		defer s.frameSrc.Close()
	}
	if s.workflowRedis != nil {
		defer s.workflowRedis.Close()
	}

	if err := s.reportStatus("starting", nil); err != nil {
		s.log.Debug("initial status report failed", "error", err)
	}

	for _, source := range resolveSampleSources(s.cfg.Sampling.FrameSource) {
		for _, camera := range s.cfg.Cameras {
			if s.cfg.Sampling.Backend == "spool" {
				go s.spoolLoop(ctx, camera.Name, source)
				continue
			}
			go s.samplerLoop(ctx, camera.Name, source)
		}
	}
	go s.handleNotifications(ctx)

	if err := s.reportStatus("idle", nil); err != nil {
		s.log.Debug("idle status report failed", "error", err)
	}

	<-ctx.Done()
	_ = s.reportStatus("stopped", map[string]any{"reason": "shutdown"})
	return nil
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
			if notification.Method != "mqtt-message" {
				continue
			}

			var message ipc.MqttMessageNotification
			if err := json.Unmarshal(notification.Params, &message); err != nil {
				s.log.Warn("invalid MQTT notification", "error", err)
				continue
			}
			if message.Subtopic != "command" {
				continue
			}
			go s.handleCommand(ctx, message.Envelope)
		}
	}
}

func (s *Service) handleCommand(ctx context.Context, env ipc.MQTTEnvelope) {
	switch env.Type {
	case "capture-event":
		var payload captureEventPayload
		if err := json.Unmarshal(env.Payload, &payload); err != nil {
			s.publishError("capture-event", "invalid payload", err, "")
			return
		}
		request, err := normalizeCaptureRequest(payload, time.Now().UTC())
		if err != nil {
			s.publishError("capture-event", "invalid payload", err, payload.RequestID)
			return
		}
		if request.PlaybackFPS <= 0 {
			request.PlaybackFPS = s.cfg.Output.PlaybackFPS
		}
		if err := s.publish("response", "capture-event-ack", request.acceptedPayload()); err != nil {
			s.log.Warn("publish capture-event ack failed", "error", err)
		}
		if err := s.captureEvent(ctx, request); err != nil {
			s.publishError("capture-event", "capture failed", err, request.RequestID)
			return
		}
	default:
		s.log.Debug("ignoring unsupported recorder command", "type", env.Type)
	}
}

func (s *Service) samplerLoop(ctx context.Context, cameraName string, source livefeed.LiveFrameSource) {
	interval := time.Second / time.Duration(s.cfg.Sampling.SampleFPS)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	lastImgID := ""
	sourceDir := filepath.Join(s.cfg.Sampling.SpoolDir, string(source), sanitizePathSegment(cameraName))
	if err := os.MkdirAll(sourceDir, 0o755); err != nil {
		s.log.Warn("create sample directory failed", "camera", cameraName, "source", source, "error", err)
		return
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			frameData, imgID, err := s.frameSrc.ReadFrame(ctx, cameraName, source)
			if err != nil {
				continue
			}
			if imgID == "" || imgID == lastImgID {
				continue
			}
			lastImgID = imgID

			fileName := fmt.Sprintf("%d_%s.jpg", time.Now().UTC().UnixNano(), sanitizePathSegment(imgID))
			samplePath := filepath.Join(sourceDir, fileName)
			if err := os.WriteFile(samplePath, frameData, 0o644); err != nil {
				s.log.Warn("write sampled frame failed", "camera", cameraName, "source", source, "error", err)
				continue
			}

			s.storesMu.RLock()
			store := s.samples[source]
			s.storesMu.RUnlock()
			if store == nil {
				continue
			}
			store.add(sampledFrameRef{
				CameraName: cameraName,
				CapturedAt: time.Now().UTC(),
				ImgID:      imgID,
				Path:       samplePath,
			})
		}
	}
}

func (s *Service) spoolLoop(ctx context.Context, cameraName string, source livefeed.LiveFrameSource) {
	sourceDir := filepath.Join(s.cfg.Sampling.SpoolDir, string(source), sanitizePathSegment(cameraName))
	if err := os.MkdirAll(sourceDir, 0o755); err != nil {
		s.log.Warn("create sample directory failed", "camera", cameraName, "source", source, "error", err)
		return
	}

	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()

	lastPath := ""
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			entries, err := os.ReadDir(sourceDir)
			if err != nil {
				continue
			}
			names := make([]string, 0, len(entries))
			for _, entry := range entries {
				if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".jpg") {
					continue
				}
				names = append(names, entry.Name())
			}
			sort.Strings(names)
			for _, name := range names {
				fullPath := filepath.Join(sourceDir, name)
				if lastPath != "" && fullPath <= lastPath {
					continue
				}
				capturedAt, imgID := parseSpoolFrameName(name)
				s.storesMu.RLock()
				store := s.samples[source]
				s.storesMu.RUnlock()
				if store == nil {
					continue
				}
				store.add(sampledFrameRef{
					CameraName: cameraName,
					CapturedAt: capturedAt,
					ImgID:      imgID,
					Path:       fullPath,
				})
				lastPath = fullPath
			}
		}
	}
}

func (s *Service) captureEvent(ctx context.Context, request captureRequest) error {
	if err := s.reportStatus("processing", map[string]any{"eventId": request.EventID}); err != nil {
		s.log.Debug("processing status report failed", "error", err)
	}

	framesByCamera, err := s.collectFrames(request)
	if err != nil {
		return err
	}

	jpegFrames, err := buildClipFrames(s.cfg, request, framesByCamera)
	if err != nil {
		return err
	}

	output, err := s.buildOutputFile(request.EventID)
	if err != nil {
		return err
	}
	if err := s.writer.WriteJPEGClip(output.AbsolutePath, jpegFrames, request.PlaybackFPS); err != nil {
		return err
	}

	result := request.readyPayload(output, len(jpegFrames))
	if request.CloudUpload != nil && request.CloudUpload.Enabled {
		if err := s.enqueueUpload(ctx, request.CloudUpload, result); err != nil {
			return err
		}
	}

	if err := s.publish("response", "capture-event-ready", result.responsePayload()); err != nil {
		s.log.Warn("publish capture-event-ready failed", "error", err)
	}
	return s.reportStatus("idle", map[string]any{"lastClip": output.AbsolutePath})
}

func (s *Service) collectFrames(request captureRequest) (map[string][]sampledFrameRef, error) {
	source := request.Plan.FrameSource

	s.storesMu.RLock()
	store := s.samples[source]
	s.storesMu.RUnlock()
	if store == nil {
		return nil, fmt.Errorf("frame source %q is not being sampled", source)
	}

	framesByCamera := make(map[string][]sampledFrameRef, len(request.Plan.CameraNames))
	for _, cameraName := range request.Plan.CameraNames {
		frames := store.window(cameraName, request.WindowStart, request.WindowEnd)
		if len(frames) == 0 {
			return nil, fmt.Errorf("no buffered frames for %s in requested window", cameraName)
		}
		framesByCamera[cameraName] = frames
	}
	return framesByCamera, nil
}

func (s *Service) enqueueUpload(ctx context.Context, upload *cloudUploadPayload, result captureResult) error {
	if s.workflowRedis == nil {
		return fmt.Errorf("workflow queue is not configured")
	}

	job, err := buildWorkflowJob(upload, result)
	if err != nil {
		return err
	}
	encoded, err := encodeWorkflowJob(job)
	if err != nil {
		return err
	}
	if err := s.workflowRedis.LPush(ctx, s.cfg.WorkflowQueue.PendingList, encoded).Err(); err != nil {
		return fmt.Errorf("enqueue workflow upload: %w", err)
	}
	return nil
}

func (s *Service) buildOutputFile(eventID string) (outputFile, error) {
	now := time.Now().UTC()
	relativeDir := filepath.Join(
		s.cfg.Output.ClipsSubdir,
		fmt.Sprintf("%04d", now.Year()),
		fmt.Sprintf("%02d", int(now.Month())),
		fmt.Sprintf("%02d", now.Day()),
	)
	absoluteDir := filepath.Join(s.cfg.Output.FilesRoot, relativeDir)
	if err := os.MkdirAll(absoluteDir, 0o755); err != nil {
		return outputFile{}, fmt.Errorf("create output dir: %w", err)
	}

	fileName := sanitizePathSegment(eventID)
	if fileName == "" {
		fileName = fmt.Sprintf("event-%d", now.UnixNano())
	}
	relativePath := filepath.Join(relativeDir, fileName+".mp4")
	return outputFile{
		AbsolutePath: filepath.Join(s.cfg.Output.FilesRoot, relativePath),
		RelativePath: relativePath,
	}, nil
}

func (s *Service) publish(subtopic string, msgType string, payload any) error {
	return s.ipcClient.Publish(subtopic, msgType, payload)
}

func (s *Service) publishError(action string, message string, err error, requestID string) {
	payload := map[string]any{
		"action":  action,
		"error":   strings.TrimSpace(message + ": " + err.Error()),
		"service": ServiceName,
	}
	if requestID != "" {
		payload["requestId"] = requestID
	}
	if publishErr := s.publish("response", "capture-event-error", payload); publishErr != nil {
		s.log.Warn("publish recorder error failed", "error", publishErr)
	}
	if reportErr := s.ipcClient.ReportError(payload["error"].(string), false); reportErr != nil {
		s.log.Debug("report error failed", "error", reportErr)
	}
}

func (s *Service) reportStatus(status string, extra map[string]any) error {
	details := map[string]any{
		"available":       true,
		"backend":         s.cfg.Sampling.Backend,
		"bufferSeconds":   s.cfg.Sampling.MaxBufferSec,
		"cameraCount":     len(s.cfg.Cameras),
		"filesRoot":       s.cfg.Output.FilesRoot,
		"frameSources":    stringifyFrameSources(resolveSampleSources(s.cfg.Sampling.FrameSource)),
		"playbackFps":     s.cfg.Output.PlaybackFPS,
		"redis":           redisconfig.Address(s.cfg.Redis),
		"sampleFps":       s.cfg.Sampling.SampleFPS,
		"workflowPending": s.cfg.WorkflowQueue.PendingList,
	}
	for key, value := range extra {
		details[key] = value
	}
	return s.ipcClient.ReportStatus(status, details)
}

func resolveSampleSources(raw string) []livefeed.LiveFrameSource {
	switch strings.TrimSpace(raw) {
	case string(livefeed.LiveFrameSourceRaw):
		return []livefeed.LiveFrameSource{livefeed.LiveFrameSourceRaw}
	case string(livefeed.LiveFrameSourceProcessed):
		return []livefeed.LiveFrameSource{livefeed.LiveFrameSourceProcessed}
	default:
		return []livefeed.LiveFrameSource{livefeed.LiveFrameSourceRaw, livefeed.LiveFrameSourceProcessed}
	}
}

func stringifyFrameSources(sources []livefeed.LiveFrameSource) []string {
	items := make([]string, 0, len(sources))
	for _, source := range sources {
		items = append(items, string(source))
	}
	return items
}

func sanitizePathSegment(value string) string {
	replacer := strings.NewReplacer("/", "-", "\\", "-", " ", "-", ":", "-", "\t", "-")
	return strings.Trim(strings.TrimSpace(replacer.Replace(value)), "-")
}

func parseSpoolFrameName(name string) (time.Time, string) {
	base := strings.TrimSuffix(filepath.Base(name), filepath.Ext(name))
	parts := strings.SplitN(base, "_", 2)
	if len(parts) == 2 {
		if unixNs, err := strconv.ParseInt(parts[0], 10, 64); err == nil && unixNs > 0 {
			return time.Unix(0, unixNs).UTC(), parts[1]
		}
		return time.Now().UTC(), parts[1]
	}
	return time.Now().UTC(), base
}
