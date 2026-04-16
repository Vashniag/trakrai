package workflowengine

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

type QueueEnvelope struct {
	CameraID          int             `json:"camera_id"`
	CameraName        string          `json:"camera_name"`
	DetectionsInline  json.RawMessage `json:"detections,omitempty"`
	DetectionsKey     string          `json:"detections_key"`
	EnqueuedAt        time.Time       `json:"enqueued_at"`
	FrameID           string          `json:"frame_id"`
	ImageID           string          `json:"image_id"`
	Metadata          map[string]any  `json:"metadata,omitempty"`
	ProcessedFrameKey string          `json:"processed_frame_key"`
	RawFrameKey       string          `json:"raw_frame_key"`
	SourceCamID       string          `json:"source_cam_id"`
}

type WorkflowFrame struct {
	Envelope     QueueEnvelope
	Detections   DetectionDocument
	QueueLatency time.Duration
}

type DetectionDocument struct {
	CameraID            string         `json:"cam_id"`
	CameraName          string         `json:"cam_name"`
	FrameID             string         `json:"frame_id"`
	ImageID             string         `json:"imgID"`
	SystemDetectionTime time.Time      `json:"system_detection_time"`
	TotalDetection      int            `json:"totalDetection"`
	DetectionPerClass   map[string]int `json:"DetectionPerClass"`
	Boxes               []DetectionBox `json:"bbox"`
	Metadata            map[string]any `json:"metadata,omitempty"`
	Raw                 map[string]any `json:"-"`
}

type DetectionBox struct {
	Label      string         `json:"label"`
	Confidence float64        `json:"conf"`
	RawBBoxes  []float64      `json:"raw_bboxes"`
	Data       map[string]any `json:"-"`
}

func decodeQueueEnvelope(raw string, cfg *Config) (*QueueEnvelope, error) {
	var payload map[string]any
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return nil, err
	}

	cameraName := firstString(payload, "camera_name", "cameraName")
	if cameraName == "" {
		return nil, fmt.Errorf("camera_name is required")
	}

	frameID := firstString(payload, "frame_id", "img_id", "imgID", "image_id")
	if frameID == "" {
		return nil, fmt.Errorf("frame_id is required")
	}

	detectionsKey := firstString(payload, "detections_key", "detectionsKey")
	rawInlineDetections := rawInlineJSON(payload, "detections", "detection_payload")
	if detectionsKey == "" {
		detectionsKey = fmt.Sprintf("%s:%s:detections", cfg.Redis.KeyPrefix, cameraName)
	}
	if detectionsKey == "" && len(rawInlineDetections) == 0 {
		return nil, fmt.Errorf("detections_key is required")
	}

	queueEnvelope := &QueueEnvelope{
		CameraID:          firstInt(payload, "camera_id", "cameraId"),
		CameraName:        cameraName,
		DetectionsInline:  rawInlineDetections,
		DetectionsKey:     detectionsKey,
		EnqueuedAt:        firstTime(payload, "enqueued_at", "enqueuedAt"),
		FrameID:           frameID,
		ImageID:           firstString(payload, "image_id", "img_id", "imgID"),
		Metadata:          firstMap(payload, "metadata"),
		ProcessedFrameKey: firstString(payload, "processed_frame_key", "processedFrameKey"),
		RawFrameKey:       firstString(payload, "raw_frame_key", "rawFrameKey"),
		SourceCamID:       firstString(payload, "source_cam_id", "sourceCamId"),
	}

	return queueEnvelope, nil
}

func decodeDetectionDocument(raw []byte) (*DetectionDocument, error) {
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}

	document := &DetectionDocument{
		CameraID:   firstString(payload, "cam_id", "camera_id"),
		CameraName: firstString(payload, "cam_name", "camera_name"),
		FrameID:    firstString(payload, "frame_id"),
		ImageID:    firstString(payload, "imgID", "image_id"),
		SystemDetectionTime: firstTime(
			payload,
			"system_detection_time",
			"systemDetectionTime",
		),
		TotalDetection:    firstInt(payload, "totalDetection", "total_detection"),
		DetectionPerClass: coerceCountMap(payload["DetectionPerClass"]),
		Boxes:             coerceBoxes(payload["bbox"]),
		Metadata:          firstMap(payload, "metadata"),
		Raw:               payload,
	}

	if document.CameraName == "" {
		return nil, fmt.Errorf("cam_name is required")
	}
	if document.FrameID == "" && document.ImageID == "" {
		return nil, fmt.Errorf("frame_id or imgID is required")
	}
	if document.FrameID == "" {
		document.FrameID = document.ImageID
	}
	if document.TotalDetection == 0 && len(document.Boxes) > 0 {
		document.TotalDetection = len(document.Boxes)
	}
	if document.SystemDetectionTime.IsZero() {
		document.SystemDetectionTime = time.Now().UTC()
	}

	return document, nil
}

func rawInlineJSON(payload map[string]any, keys ...string) json.RawMessage {
	for _, key := range keys {
		value, ok := payload[key]
		if !ok || value == nil {
			continue
		}
		encoded, err := json.Marshal(value)
		if err == nil {
			return encoded
		}
	}
	return nil
}

func firstString(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := payload[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case string:
			trimmed := strings.TrimSpace(typed)
			if trimmed != "" {
				return trimmed
			}
		case json.Number:
			return typed.String()
		case float64:
			if typed == math.Trunc(typed) {
				return strconv.FormatInt(int64(typed), 10)
			}
			return strconv.FormatFloat(typed, 'f', -1, 64)
		case int:
			return strconv.Itoa(typed)
		}
	}
	return ""
}

func firstInt(payload map[string]any, keys ...string) int {
	for _, key := range keys {
		value, ok := payload[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return int(typed)
		case int:
			return typed
		case int64:
			return int(typed)
		case json.Number:
			if parsed, err := typed.Int64(); err == nil {
				return int(parsed)
			}
		case string:
			parsed, err := strconv.Atoi(strings.TrimSpace(typed))
			if err == nil {
				return parsed
			}
		}
	}
	return 0
}

func firstTime(payload map[string]any, keys ...string) time.Time {
	for _, key := range keys {
		value, ok := payload[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case string:
			trimmed := strings.TrimSpace(typed)
			if trimmed == "" {
				continue
			}
			if parsed, err := time.Parse(time.RFC3339Nano, trimmed); err == nil {
				return parsed.UTC()
			}
			if parsed, err := strconv.ParseFloat(trimmed, 64); err == nil {
				return floatTimestampToTime(parsed)
			}
		case float64:
			return floatTimestampToTime(typed)
		case json.Number:
			if parsed, err := typed.Float64(); err == nil {
				return floatTimestampToTime(parsed)
			}
		}
	}
	return time.Time{}
}

func firstMap(payload map[string]any, key string) map[string]any {
	value, ok := payload[key]
	if !ok || value == nil {
		return map[string]any{}
	}
	typed, ok := value.(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return typed
}

func floatTimestampToTime(value float64) time.Time {
	seconds := int64(value)
	nanos := int64((value - float64(seconds)) * float64(time.Second))
	return time.Unix(seconds, nanos).UTC()
}

func coerceCountMap(value any) map[string]int {
	rawMap, ok := value.(map[string]any)
	if !ok {
		return map[string]int{}
	}
	counts := make(map[string]int, len(rawMap))
	for key, rawValue := range rawMap {
		switch typed := rawValue.(type) {
		case float64:
			counts[key] = int(typed)
		case int:
			counts[key] = typed
		case string:
			parsed, err := strconv.Atoi(strings.TrimSpace(typed))
			if err == nil {
				counts[key] = parsed
			}
		}
	}
	return counts
}

func coerceBoxes(value any) []DetectionBox {
	rawBoxes, ok := value.([]any)
	if !ok {
		return nil
	}
	boxes := make([]DetectionBox, 0, len(rawBoxes))
	for _, rawBox := range rawBoxes {
		rawMap, ok := rawBox.(map[string]any)
		if !ok {
			continue
		}
		box := DetectionBox{
			Label:      firstString(rawMap, "label"),
			Confidence: firstFloat(rawMap, "conf", "confidence"),
			RawBBoxes:  coerceFloatSlice(rawMap["raw_bboxes"]),
			Data:       rawMap,
		}
		boxes = append(boxes, box)
	}
	return boxes
}

func firstFloat(payload map[string]any, keys ...string) float64 {
	for _, key := range keys {
		value, ok := payload[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return typed
		case int:
			return float64(typed)
		case json.Number:
			if parsed, err := typed.Float64(); err == nil {
				return parsed
			}
		case string:
			parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
			if err == nil {
				return parsed
			}
		}
	}
	return 0
}

func coerceFloatSlice(value any) []float64 {
	rawValues, ok := value.([]any)
	if !ok {
		return nil
	}
	values := make([]float64, 0, len(rawValues))
	for _, rawValue := range rawValues {
		switch typed := rawValue.(type) {
		case float64:
			values = append(values, typed)
		case int:
			values = append(values, float64(typed))
		case string:
			parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
			if err == nil {
				values = append(values, parsed)
			}
		}
	}
	return values
}
