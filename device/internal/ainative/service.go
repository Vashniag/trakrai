package ainative

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/trakrai/device-services/internal/ipc"
	"github.com/trakrai/device-services/internal/livefeed"
	"github.com/trakrai/device-services/internal/shared/redisconfig"
)

const (
	detectionsSuffix     = "detections"
	detectionsTimeSuffix = "detections_time"
	processedSuffix      = "processed"
	processedTimeSuffix  = "processed_time"
	processedImagesKey   = "processed_images"
)

type Service struct {
	backend    Backend
	cfg        *Config
	frameSrc   *livefeed.FrameSource
	ipcClient  *ipc.Client
	lastImgIDs map[string]string
	log        *slog.Logger
	redis      *redis.Client
}

func NewService(cfg *Config) (*Service, error) {
	frameSource, err := livefeed.NewFrameSource(cfg.Redis)
	if err != nil {
		return nil, err
	}
	backend, err := newBackend(cfg.Backend, slog.With("component", ServiceName, "part", "backend"))
	if err != nil {
		frameSource.Close()
		return nil, err
	}
	redisClient := redis.NewClient(&redis.Options{
		Addr:     redisconfig.Address(cfg.Redis),
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
	})
	return &Service{
		backend:    backend,
		cfg:        cfg,
		frameSrc:   frameSource,
		ipcClient:  ipc.NewClient(cfg.IPC.SocketPath, ServiceName),
		lastImgIDs: make(map[string]string, len(cfg.Cameras)),
		log:        slog.With("component", ServiceName),
		redis:      redisClient,
	}, nil
}

func (s *Service) Run(ctx context.Context) error {
	s.ipcClient.Start()
	defer s.ipcClient.Close()
	defer s.frameSrc.Close()
	defer s.redis.Close()
	defer s.backend.Close()

	if err := s.reportStatus("starting", nil); err != nil {
		s.log.Debug("initial status report failed", "error", err)
	}

	for {
		select {
		case <-ctx.Done():
			_ = s.reportStatus("stopped", map[string]any{"reason": "shutdown"})
			return nil
		default:
		}

		processedAny := false
		for _, camera := range s.cfg.Cameras {
			processed, err := s.processCamera(ctx, camera)
			if err != nil {
				s.log.Warn("camera processing failed", "camera", camera.Name, "error", err)
				_ = s.ipcClient.ReportError(err.Error(), false)
				continue
			}
			processedAny = processedAny || processed
		}

		sleepFor := time.Duration(s.cfg.Inference.IdleSleepMs) * time.Millisecond
		if processedAny {
			sleepFor = time.Duration(s.cfg.Inference.PollIntervalMs) * time.Millisecond
		}
		time.Sleep(sleepFor)
	}
}

func (s *Service) processCamera(ctx context.Context, camera CameraConfig) (bool, error) {
	frameData, frameID, err := s.frameSrc.ReadFrame(ctx, camera.Name, livefeed.LiveFrameSourceRaw)
	if err != nil {
		return false, nil
	}
	if frameID == "" || frameID == s.lastImgIDs[camera.Name] {
		return false, nil
	}

	cameraDir := filepath.Join(s.cfg.Staging.Dir, sanitizeField(camera.Name))
	if err := os.MkdirAll(cameraDir, 0o755); err != nil {
		return false, fmt.Errorf("prepare staging dir: %w", err)
	}

	inputPath := filepath.Join(cameraDir, sanitizeField(frameID)+".jpg")
	annotatedPath := filepath.Join(cameraDir, sanitizeField(frameID)+".annotated.jpg")
	if err := os.WriteFile(inputPath, frameData, 0o644); err != nil {
		return false, fmt.Errorf("write input frame: %w", err)
	}

	request := InferenceRequest{
		AnnotatedPath: annotatedPath,
		Camera:        camera,
		FrameID:       frameID,
		InputPath:     inputPath,
	}
	timeout := time.Duration(s.cfg.Backend.ResponseTimeoutMs) * time.Millisecond
	inferCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	result, err := s.backend.Infer(inferCtx, request)
	if err != nil {
		return false, fmt.Errorf("infer frame %s: %w", frameID, err)
	}

	annotatedBytes, err := os.ReadFile(result.AnnotatedPath)
	if err != nil {
		annotatedBytes = frameData
	}
	if err := s.storeOutputs(ctx, camera, frameID, annotatedBytes, result); err != nil {
		return false, err
	}

	if !s.cfg.Staging.RetainInputJPG {
		_ = os.Remove(inputPath)
	}
	if !s.cfg.Staging.RetainAnnotatedJPG && result.AnnotatedPath != inputPath {
		_ = os.Remove(result.AnnotatedPath)
	}

	s.lastImgIDs[camera.Name] = frameID
	s.log.Info("processed frame",
		"camera", camera.Name,
		"frame_id", frameID,
		"detections", len(result.Detections),
		"latency_ms", result.LatencyMs,
	)
	_ = s.reportStatus("running", map[string]any{
		"lastCamera":  camera.Name,
		"lastFrameId": frameID,
		"lastLatency": result.LatencyMs,
	})
	return true, nil
}

func (s *Service) storeOutputs(ctx context.Context, camera CameraConfig, frameID string, annotated []byte, result InferenceResult) error {
	counts := make(map[string]int)
	bbox := make([]map[string]any, 0, len(result.Detections))
	for _, detection := range result.Detections {
		label := strings.TrimSpace(detection.Label)
		if label == "" {
			label = "object"
		}
		counts[label]++
		bbox = append(bbox, map[string]any{
			"label":      label,
			"conf":       detection.Confidence,
			"raw_bboxes": []float64{detection.Left, detection.Top, detection.Right, detection.Bottom},
		})
	}

	payload := map[string]any{
		"cam_id":                fmt.Sprintf("%d", camera.ID),
		"cam_name":              camera.Name,
		"frame_id":              frameID,
		"imgID":                 frameID,
		"system_detection_time": float64(time.Now().Unix()),
		"totalDetection":        len(result.Detections),
		"DetectionPerClass":     counts,
		"bbox":                  bbox,
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal detection payload: %w", err)
	}

	pipe := s.redis.TxPipeline()
	pipe.Set(ctx, s.cameraKey(camera.Name, processedSuffix), annotated, 0)
	pipe.Set(ctx, s.cameraKey(camera.Name, processedTimeSuffix), frameID, 0)
	pipe.LPush(ctx, s.cameraKey(camera.Name, processedImagesKey), annotated)
	pipe.LTrim(ctx, s.cameraKey(camera.Name, processedImagesKey), 0, int64(s.cfg.Inference.ProcessedImagesMaxLen-1))
	pipe.Set(ctx, s.cameraKey(camera.Name, detectionsSuffix), payloadJSON, 0)
	pipe.Set(ctx, s.cameraKey(camera.Name, detectionsTimeSuffix), frameID, 0)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("store outputs: %w", err)
	}
	return nil
}

func (s *Service) cameraKey(cameraName string, suffix string) string {
	return fmt.Sprintf("%s:%s:%s", s.cfg.Redis.KeyPrefix, cameraName, suffix)
}

func (s *Service) reportStatus(status string, extra map[string]any) error {
	details := map[string]any{
		"available":          true,
		"backendMode":        s.cfg.Backend.Mode,
		"cameraCount":        len(s.cfg.Cameras),
		"processedImageList": s.cfg.Inference.ProcessedImagesMaxLen,
		"redis":              redisconfig.Address(s.cfg.Redis),
		"stagingDir":         s.cfg.Staging.Dir,
	}
	for key, value := range extra {
		details[key] = value
	}
	return s.ipcClient.ReportStatus(status, details)
}
