package eventrecorder

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/trakrai/device-services/internal/livefeed"
	"github.com/trakrai/device-services/internal/workflowcomm"
)

type captureEventPayload struct {
	CameraName  string              `json:"cameraName"`
	CameraNames []string            `json:"cameraNames"`
	CloudUpload *cloudUploadPayload `json:"cloudUpload,omitempty"`
	EndedAt     string              `json:"endedAt,omitempty"`
	EventID     string              `json:"eventId,omitempty"`
	FrameSource string              `json:"frameSource,omitempty"`
	LayoutMode  string              `json:"layoutMode,omitempty"`
	PlaybackFPS int                 `json:"playbackFps,omitempty"`
	PostSeconds int                 `json:"postSeconds,omitempty"`
	PreSeconds  int                 `json:"preSeconds,omitempty"`
	RequestID   string              `json:"requestId,omitempty"`
	StartedAt   string              `json:"startedAt,omitempty"`
}

type cloudUploadPayload struct {
	Data     map[string]any            `json:"data,omitempty"`
	Enabled  bool                      `json:"enabled"`
	FileTag  string                    `json:"fileTag,omitempty"`
	Finalize *workflowcomm.HTTPRequest `json:"finalize,omitempty"`
	JobID    string                    `json:"jobId,omitempty"`
	JobKind  string                    `json:"jobKind,omitempty"`
	Presign  *workflowcomm.HTTPRequest `json:"presign,omitempty"`
}

type captureRequest struct {
	CloudUpload *cloudUploadPayload
	EventID     string
	PlaybackFPS int
	Plan        livefeed.LiveLayoutPlan
	PostSeconds int
	PreSeconds  int
	RequestID   string
	WindowEnd   time.Time
	WindowStart time.Time
}

type sampledFrameRef struct {
	CameraName string
	CapturedAt time.Time
	ImgID      string
	Path       string
}

type outputFile struct {
	AbsolutePath string
	RelativePath string
}

type captureResult struct {
	CameraNames  []string
	EventID      string
	File         outputFile
	FrameCount   int
	LayoutMode   string
	PlaybackFPS  int
	RequestID    string
	SampleSource string
	WindowEnd    time.Time
	WindowStart  time.Time
}

func normalizeCaptureRequest(payload captureEventPayload, now time.Time) (captureRequest, error) {
	frameSource := strings.TrimSpace(payload.FrameSource)
	if frameSource == "" {
		frameSource = string(livefeed.LiveFrameSourceProcessed)
	}
	plan, err := livefeed.NormalizeLiveLayoutPlan(
		payload.LayoutMode,
		payload.CameraName,
		payload.CameraNames,
		frameSource,
	)
	if err != nil {
		return captureRequest{}, err
	}

	startedAt := now
	if strings.TrimSpace(payload.StartedAt) != "" {
		startedAt, err = time.Parse(time.RFC3339Nano, payload.StartedAt)
		if err != nil {
			return captureRequest{}, fmt.Errorf("parse startedAt: %w", err)
		}
	}

	endedAt := now
	if strings.TrimSpace(payload.EndedAt) != "" {
		endedAt, err = time.Parse(time.RFC3339Nano, payload.EndedAt)
		if err != nil {
			return captureRequest{}, fmt.Errorf("parse endedAt: %w", err)
		}
	}
	if endedAt.Before(startedAt) {
		startedAt, endedAt = endedAt, startedAt
	}

	preSeconds := payload.PreSeconds
	if preSeconds < 0 {
		preSeconds = 0
	}
	postSeconds := payload.PostSeconds
	if postSeconds < 0 {
		postSeconds = 0
	}

	playbackFPS := payload.PlaybackFPS
	if playbackFPS <= 0 {
		playbackFPS = 24
	}

	eventID := strings.TrimSpace(payload.EventID)
	if eventID == "" {
		eventID = fmt.Sprintf("event-%d", now.UnixNano())
	}

	requestID := strings.TrimSpace(payload.RequestID)

	return captureRequest{
		CloudUpload: payload.CloudUpload,
		EventID:     eventID,
		PlaybackFPS: playbackFPS,
		Plan:        plan,
		PostSeconds: postSeconds,
		PreSeconds:  preSeconds,
		RequestID:   requestID,
		WindowStart: startedAt.Add(-time.Duration(preSeconds) * time.Second),
		WindowEnd:   endedAt.Add(time.Duration(postSeconds) * time.Second),
	}, nil
}

func (r captureResult) responsePayload() map[string]any {
	payload := map[string]any{
		"cameraNames":  append([]string(nil), r.CameraNames...),
		"eventId":      r.EventID,
		"filePath":     r.File.AbsolutePath,
		"frameCount":   r.FrameCount,
		"layoutMode":   r.LayoutMode,
		"playbackFps":  r.PlaybackFPS,
		"relativePath": r.File.RelativePath,
		"sampleSource": r.SampleSource,
		"windowEnd":    r.WindowEnd.UTC().Format(time.RFC3339Nano),
		"windowStart":  r.WindowStart.UTC().Format(time.RFC3339Nano),
	}
	if r.RequestID != "" {
		payload["requestId"] = r.RequestID
	}
	return payload
}

func (r captureRequest) readyPayload(file outputFile, frameCount int) captureResult {
	return captureResult{
		CameraNames:  append([]string(nil), r.Plan.CameraNames...),
		EventID:      r.EventID,
		File:         file,
		FrameCount:   frameCount,
		LayoutMode:   string(r.Plan.Mode),
		PlaybackFPS:  r.PlaybackFPS,
		RequestID:    r.RequestID,
		SampleSource: string(r.Plan.FrameSource),
		WindowEnd:    r.WindowEnd,
		WindowStart:  r.WindowStart,
	}
}

func (r captureRequest) acceptedPayload() map[string]any {
	payload := map[string]any{
		"accepted":    true,
		"cameraNames": append([]string(nil), r.Plan.CameraNames...),
		"eventId":     r.EventID,
		"layoutMode":  string(r.Plan.Mode),
		"playbackFps": r.PlaybackFPS,
		"windowEnd":   r.WindowEnd.UTC().Format(time.RFC3339Nano),
		"windowStart": r.WindowStart.UTC().Format(time.RFC3339Nano),
	}
	if r.RequestID != "" {
		payload["requestId"] = r.RequestID
	}
	return payload
}

func buildWorkflowJob(upload *cloudUploadPayload, result captureResult) (*workflowcomm.Job, error) {
	if upload == nil || !upload.Enabled {
		return nil, nil
	}
	if upload.Presign == nil || upload.Finalize == nil {
		return nil, fmt.Errorf("cloud upload requires presign and finalize requests")
	}

	fileTag := strings.TrimSpace(upload.FileTag)
	if fileTag == "" {
		fileTag = "clip"
	}
	jobID := strings.TrimSpace(upload.JobID)
	if jobID == "" {
		jobID = result.EventID
	}

	fileName := filepath.Base(result.File.AbsolutePath)
	data := make(map[string]any, len(upload.Data)+4)
	for key, value := range upload.Data {
		data[key] = value
	}
	data["cameraNames"] = append([]string(nil), result.CameraNames...)
	data["eventId"] = result.EventID
	data["layoutMode"] = result.LayoutMode
	data["requestId"] = result.RequestID

	return &workflowcomm.Job{
		ID:   jobID,
		Kind: strings.TrimSpace(upload.JobKind),
		Data: data,
		Files: []workflowcomm.FileSpec{{
			Tag:         fileTag,
			Path:        result.File.RelativePath,
			FileName:    fileName,
			ContentType: "video/mp4",
		}},
		Presign:  upload.Presign,
		Finalize: upload.Finalize,
	}, nil
}

func encodeWorkflowJob(job *workflowcomm.Job) (string, error) {
	if job == nil {
		return "", nil
	}
	data, err := json.Marshal(job)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
