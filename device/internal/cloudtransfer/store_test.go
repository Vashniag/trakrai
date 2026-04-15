package cloudtransfer

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestStoreLifecycle(t *testing.T) {
	t.Parallel()

	store, err := OpenStore(filepath.Join(t.TempDir(), "transfers.sqlite"))
	if err != nil {
		t.Fatalf("OpenStore returned error: %v", err)
	}
	defer store.Close()

	ctx := context.Background()
	now := time.Date(2026, 4, 15, 10, 0, 0, 0, time.UTC)
	deadline := now.Add(24 * time.Hour)

	inserted, err := store.Enqueue(ctx, Transfer{
		CreatedAt:     now,
		DeadlineAt:    &deadline,
		DeviceID:      "trakrai-device-local",
		Direction:     DirectionUpload,
		ID:            "transfer-1",
		LocalPath:     "/tmp/shared/file.txt",
		NextAttemptAt: &now,
		RemotePath:    "captures/file.txt",
		State:         StateQueued,
		UpdatedAt:     now,
	})
	if err != nil {
		t.Fatalf("Enqueue returned error: %v", err)
	}

	acquired, err := store.AcquireDueTransfer(ctx, now)
	if err != nil {
		t.Fatalf("AcquireDueTransfer returned error: %v", err)
	}
	if acquired == nil {
		t.Fatal("expected a due transfer to be acquired")
	}
	if acquired.ID != inserted.ID {
		t.Fatalf("unexpected transfer acquired: %s", acquired.ID)
	}
	if acquired.State != StateRunning {
		t.Fatalf("unexpected acquired state: %s", acquired.State)
	}
	if acquired.Attempts != 1 {
		t.Fatalf("unexpected attempt count after acquire: %d", acquired.Attempts)
	}

	retryAt := now.Add(2 * time.Minute)
	if err := store.MarkRetry(ctx, inserted.ID, retryAt, "temporary failure", "devices/trakrai-device-local/captures/file.txt", retryAt); err != nil {
		t.Fatalf("MarkRetry returned error: %v", err)
	}

	stats, err := store.Stats(ctx)
	if err != nil {
		t.Fatalf("Stats returned error: %v", err)
	}
	if stats.Pending != 1 {
		t.Fatalf("unexpected pending count after retry: %d", stats.Pending)
	}
	if stats.UploadQueued != 1 {
		t.Fatalf("unexpected upload queued count after retry: %d", stats.UploadQueued)
	}

	acquired, err = store.AcquireDueTransfer(ctx, retryAt)
	if err != nil {
		t.Fatalf("AcquireDueTransfer on retry returned error: %v", err)
	}
	if acquired == nil {
		t.Fatal("expected retry transfer to be acquired")
	}
	if acquired.Attempts != 2 {
		t.Fatalf("unexpected attempt count after retry acquire: %d", acquired.Attempts)
	}

	completedAt := retryAt.Add(30 * time.Second)
	if err := store.MarkCompleted(ctx, inserted.ID, "devices/trakrai-device-local/captures/file.txt", completedAt); err != nil {
		t.Fatalf("MarkCompleted returned error: %v", err)
	}

	loaded, err := store.GetTransfer(ctx, inserted.ID)
	if err != nil {
		t.Fatalf("GetTransfer returned error: %v", err)
	}
	if loaded.State != StateCompleted {
		t.Fatalf("unexpected completed state: %s", loaded.State)
	}
	if loaded.ObjectKey != "devices/trakrai-device-local/captures/file.txt" {
		t.Fatalf("unexpected object key: %s", loaded.ObjectKey)
	}

	stats, err = store.Stats(ctx)
	if err != nil {
		t.Fatalf("Stats after completion returned error: %v", err)
	}
	if stats.Completed != 1 || stats.UploadsCompleted != 1 {
		t.Fatalf("unexpected completion stats: %+v", stats)
	}
}
