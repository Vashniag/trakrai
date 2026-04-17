package videorecorder

import (
	"testing"
	"time"
)

func TestCameraBufferPrunesByAgeAndLimits(t *testing.T) {
	buffer, err := newCameraBuffer(
		CameraConfig{ID: "1", Name: "Camera-1", Width: 640, Height: 480},
		t.TempDir(),
		2*time.Second,
		10,
		2,
		1024,
	)
	if err != nil {
		t.Fatalf("newCameraBuffer() error = %v", err)
	}
	defer buffer.close()

	base := time.Date(2026, 4, 17, 12, 0, 0, 0, time.UTC)
	if _, err := buffer.addFrame("frame-1", base, []byte("1111")); err != nil {
		t.Fatalf("addFrame(frame-1) error = %v", err)
	}
	if _, err := buffer.addFrame("frame-2", base.Add(500*time.Millisecond), []byte("2222")); err != nil {
		t.Fatalf("addFrame(frame-2) error = %v", err)
	}
	if _, err := buffer.addFrame("frame-3", base.Add(3*time.Second), []byte("3333")); err != nil {
		t.Fatalf("addFrame(frame-3) error = %v", err)
	}

	status := buffer.status()
	if status.Frames != 1 {
		t.Fatalf("expected 1 frame after pruning, got %d", status.Frames)
	}
	if status.LatestImageID != "frame-3" {
		t.Fatalf("expected latest image id frame-3, got %q", status.LatestImageID)
	}
}

func TestCameraBufferNearestFrameUsesClosestTimestamp(t *testing.T) {
	buffer, err := newCameraBuffer(
		CameraConfig{ID: "1", Name: "Camera-1", Width: 640, Height: 480},
		t.TempDir(),
		10*time.Second,
		1024,
		10,
		1024,
	)
	if err != nil {
		t.Fatalf("newCameraBuffer() error = %v", err)
	}
	defer buffer.close()

	base := time.Date(2026, 4, 17, 12, 0, 0, 0, time.UTC)
	if _, err := buffer.addFrame("frame-1", base, []byte("1111")); err != nil {
		t.Fatalf("addFrame(frame-1) error = %v", err)
	}
	if _, err := buffer.addFrame("frame-2", base.Add(2*time.Second), []byte("2222")); err != nil {
		t.Fatalf("addFrame(frame-2) error = %v", err)
	}

	frame, ok, err := buffer.nearestFrame(base.Add(1700 * time.Millisecond))
	if err != nil {
		t.Fatalf("nearestFrame() error = %v", err)
	}
	if !ok {
		t.Fatal("expected to find a nearest frame")
	}
	if frame.imageID != "frame-2" {
		t.Fatalf("expected frame-2 to be nearest, got %q", frame.imageID)
	}
	if string(frame.jpeg) != "2222" {
		t.Fatalf("expected to read back frame bytes, got %q", string(frame.jpeg))
	}
}

func TestSelectFramesForClipRepeatsLatestFrameAcrossTargets(t *testing.T) {
	base := time.Date(2026, 4, 17, 12, 0, 0, 0, time.UTC)
	frames := []bufferedFrame{
		{imageID: "frame-1", timestamp: base},
		{imageID: "frame-2", timestamp: base.Add(500 * time.Millisecond)},
	}

	selected := selectFramesForClip(frames, base.Add(500*time.Millisecond), 0.5, 0.5, 4)
	if len(selected) == 0 {
		t.Fatal("expected frames to be selected")
	}
	if selected[0].imageID != "frame-1" {
		t.Fatalf("expected first selected frame to use earliest image, got %q", selected[0].imageID)
	}
	if selected[len(selected)-1].imageID != "frame-2" {
		t.Fatalf("expected latest selected frame to reuse most recent image, got %q", selected[len(selected)-1].imageID)
	}
}

func TestResolveSharedPathRejectsTraversal(t *testing.T) {
	_, _, err := resolveSharedPath("/tmp/trakrai-shared", "../outside.mp4")
	if err == nil {
		t.Fatal("expected traversal path to be rejected")
	}
}
