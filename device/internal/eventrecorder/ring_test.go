package eventrecorder

import (
    "path/filepath"
    "testing"
    "time"
)

func TestFrameRingWindow(t *testing.T) {
    ring := newFrameRing(3)
    base := time.Date(2026, 4, 15, 10, 0, 0, 0, time.UTC)
    ring.add(sampledFrameRef{CameraName: "Cam-1", CapturedAt: base.Add(-2 * time.Second), Path: filepath.Join("a", "1.jpg")})
    ring.add(sampledFrameRef{CameraName: "Cam-1", CapturedAt: base.Add(-1 * time.Second), Path: filepath.Join("a", "2.jpg")})
    ring.add(sampledFrameRef{CameraName: "Cam-1", CapturedAt: base, Path: filepath.Join("a", "3.jpg")})

    frames := ring.window(base.Add(-1500*time.Millisecond), base.Add(-500*time.Millisecond))
    if len(frames) != 1 {
        t.Fatalf("expected 1 frame, got %d", len(frames))
    }
    if got := filepath.Base(frames[0].Path); got != "2.jpg" {
        t.Fatalf("unexpected frame selected: %s", got)
    }
}
