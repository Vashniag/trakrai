package workflowengine

import (
	"testing"
	"time"
)

func TestDecodeQueueEnvelopeSupportsLegacyPayload(t *testing.T) {
	t.Parallel()

	cfg := &Config{}
	cfg.Redis.KeyPrefix = "camera"

	frame, err := decodeQueueEnvelope(`{
		"camera_id": 5,
		"camera_name": "gate-1",
		"imgID": "img-123",
		"source_cam_id": "cam-src",
		"raw_frame_key": "camera:gate-1:latest",
		"processed_frame_key": "camera:gate-1:processed",
		"detections_key": "camera:gate-1:detections",
		"enqueued_at": 1713186938.25
	}`, cfg)
	if err != nil {
		t.Fatalf("decodeQueueEnvelope returned error: %v", err)
	}

	if frame.CameraName != "gate-1" {
		t.Fatalf("unexpected camera name: %s", frame.CameraName)
	}
	if frame.FrameID != "img-123" {
		t.Fatalf("unexpected frame id: %s", frame.FrameID)
	}
	if frame.DetectionsKey != "camera:gate-1:detections" {
		t.Fatalf("unexpected detections key: %s", frame.DetectionsKey)
	}
	if frame.EnqueuedAt.IsZero() {
		t.Fatal("expected enqueued_at to be parsed")
	}
}

func TestDecodeQueueEnvelopeFallsBackToDerivedDetectionsKey(t *testing.T) {
	t.Parallel()

	cfg := &Config{}
	cfg.Redis.KeyPrefix = "camera"

	frame, err := decodeQueueEnvelope(`{
		"camera_name": "dock-2",
		"frame_id": "frame-777",
		"detections": {"cam_name":"dock-2","frame_id":"frame-777","bbox":[]}
	}`, cfg)
	if err != nil {
		t.Fatalf("decodeQueueEnvelope returned error: %v", err)
	}

	if frame.DetectionsKey != "camera:dock-2:detections" {
		t.Fatalf("unexpected derived key: %s", frame.DetectionsKey)
	}
	if len(frame.DetectionsInline) == 0 {
		t.Fatal("expected inline detections payload")
	}
}

func TestDecodeDetectionDocumentParsesCountsAndBoxes(t *testing.T) {
	t.Parallel()

	document, err := decodeDetectionDocument([]byte(`{
		"cam_id": "12",
		"cam_name": "yard-west",
		"frame_id": "frame-12",
		"system_detection_time": 1713186938.5,
		"DetectionPerClass": {"person": 2, "helmet": "1"},
		"bbox": [
			{"label":"person","conf":0.92,"raw_bboxes":[10,20,"30","40"]},
			{"label":"helmet","confidence":"0.88","raw_bboxes":[1,2,3,4]}
		]
	}`))
	if err != nil {
		t.Fatalf("decodeDetectionDocument returned error: %v", err)
	}

	if document.TotalDetection != 2 {
		t.Fatalf("expected 2 detections, got %d", document.TotalDetection)
	}
	if document.DetectionPerClass["helmet"] != 1 {
		t.Fatalf("expected helmet count to be 1, got %d", document.DetectionPerClass["helmet"])
	}
	if len(document.Boxes) != 2 {
		t.Fatalf("expected 2 boxes, got %d", len(document.Boxes))
	}
	if document.Boxes[1].Confidence != 0.88 {
		t.Fatalf("unexpected confidence: %f", document.Boxes[1].Confidence)
	}
	if document.SystemDetectionTime.IsZero() {
		t.Fatal("expected system detection time to be parsed")
	}
}

func TestIsStaleFrameHonorsConfigThreshold(t *testing.T) {
	t.Parallel()

	cfg := &Config{}
	cfg.Queue.StaleAfterSec = 5

	staleFrame := &QueueEnvelope{EnqueuedAt: time.Now().Add(-10 * time.Second)}
	if !isStaleFrame(staleFrame, cfg) {
		t.Fatal("expected frame to be stale")
	}

	freshFrame := &QueueEnvelope{EnqueuedAt: time.Now().Add(-2 * time.Second)}
	if isStaleFrame(freshFrame, cfg) {
		t.Fatal("expected frame to be fresh")
	}
}
