package cloudtransfer

import (
	"path/filepath"
	"testing"
	"time"
)

func TestNormalizeRemotePath(t *testing.T) {
	t.Parallel()

	got, err := normalizeRemotePath("captures/2026/clip.mp4")
	if err != nil {
		t.Fatalf("normalizeRemotePath returned error: %v", err)
	}
	if got != "captures/2026/clip.mp4" {
		t.Fatalf("unexpected normalized remote path: %s", got)
	}

	if _, err := normalizeRemotePath("../escape.txt"); err == nil {
		t.Fatal("expected remote path traversal to be rejected")
	}
}

func TestNormalizeSharedPath(t *testing.T) {
	t.Parallel()

	sharedDir := filepath.Join(t.TempDir(), "shared")
	got, err := normalizeSharedPath(sharedDir, "captures/frame.jpg")
	if err != nil {
		t.Fatalf("normalizeSharedPath returned error: %v", err)
	}
	want := filepath.Join(sharedDir, "captures", "frame.jpg")
	if got != want {
		t.Fatalf("unexpected normalized shared path: got %s want %s", got, want)
	}

	if _, err := normalizeSharedPath(sharedDir, "../escape.txt"); err == nil {
		t.Fatal("expected shared path traversal to be rejected")
	}
}

func TestParseTimeoutWindow(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 4, 15, 10, 0, 0, 0, time.UTC)
	deadline, err := parseTimeoutWindow("4h", now)
	if err != nil {
		t.Fatalf("parseTimeoutWindow returned error: %v", err)
	}
	if deadline == nil {
		t.Fatal("expected deadline to be set")
	}
	if got, want := deadline.UTC(), now.Add(4*time.Hour); !got.Equal(want) {
		t.Fatalf("unexpected deadline: got %s want %s", got, want)
	}

	dayDeadline, err := parseTimeoutWindow("1d", now)
	if err != nil {
		t.Fatalf("parseTimeoutWindow for day duration returned error: %v", err)
	}
	if dayDeadline == nil {
		t.Fatal("expected day duration deadline to be set")
	}
	if got, want := dayDeadline.UTC(), now.Add(24*time.Hour); !got.Equal(want) {
		t.Fatalf("unexpected day deadline: got %s want %s", got, want)
	}

	if _, err := parseTimeoutWindow("bad", now); err == nil {
		t.Fatal("expected invalid timeout to fail")
	}
}
