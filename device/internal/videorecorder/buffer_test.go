package videorecorder

import (
	"testing"
	"time"
)

func TestCameraBufferPrunesByAgeAndLimits(t *testing.T) {
	buffer := newCameraBuffer(
		CameraConfig{ID: "1", Name: "Camera-1", Width: 640, Height: 480},
		2*time.Second,
		10,
		2,
	)

	base := time.Date(2026, 4, 17, 12, 0, 0, 0, time.UTC)
	buffer.addFrame("frame-1", base, []byte("1111"))
	buffer.addFrame("frame-2", base.Add(500*time.Millisecond), []byte("2222"))
	buffer.addFrame("frame-3", base.Add(3*time.Second), []byte("3333"))

	status := buffer.status()
	if status.Frames != 1 {
		t.Fatalf("expected 1 frame after pruning, got %d", status.Frames)
	}
	if status.LatestImageID != "frame-3" {
		t.Fatalf("expected latest image id frame-3, got %q", status.LatestImageID)
	}
}

func TestCameraBufferNearestFrameUsesClosestTimestamp(t *testing.T) {
	buffer := newCameraBuffer(
		CameraConfig{ID: "1", Name: "Camera-1", Width: 640, Height: 480},
		10*time.Second,
		1024,
		10,
	)

	base := time.Date(2026, 4, 17, 12, 0, 0, 0, time.UTC)
	buffer.addFrame("frame-1", base, []byte("1111"))
	buffer.addFrame("frame-2", base.Add(2*time.Second), []byte("2222"))

	frame, ok := buffer.nearestFrame(base.Add(1700 * time.Millisecond))
	if !ok {
		t.Fatal("expected to find a nearest frame")
	}
	if frame.imageID != "frame-2" {
		t.Fatalf("expected frame-2 to be nearest, got %q", frame.imageID)
	}
}

func TestSelectFramesForClipRepeatsLatestFrameAcrossTargets(t *testing.T) {
	base := time.Date(2026, 4, 17, 12, 0, 0, 0, time.UTC)
	frames := []frameEntry{
		{imageID: "frame-1", timestamp: base, jpeg: []byte("1111")},
		{imageID: "frame-2", timestamp: base.Add(500 * time.Millisecond), jpeg: []byte("2222")},
	}

	selected := selectFramesForClip(frames, base.Add(500*time.Millisecond), 0.5, 0.5, 4)
	if len(selected) == 0 {
		t.Fatal("expected frames to be selected")
	}
	if string(selected[0]) != "1111" {
		t.Fatalf("expected first selected frame to use earliest jpeg, got %q", string(selected[0]))
	}
	if string(selected[len(selected)-1]) != "2222" {
		t.Fatalf("expected latest selected frame to reuse most recent jpeg, got %q", string(selected[len(selected)-1]))
	}
}

func TestResolveSharedPathRejectsTraversal(t *testing.T) {
	_, _, err := resolveSharedPath("/tmp/trakrai-shared", "../outside.mp4")
	if err == nil {
		t.Fatal("expected traversal path to be rejected")
	}
}
