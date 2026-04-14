package livefeed

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"

	"github.com/trakrai/device-services/internal/shared/redisconfig"
)

func TestFrameSourceReadFrameRaw(t *testing.T) {
	t.Parallel()

	redisServer := miniredis.RunT(t)
	redisServer.HSet("camera:LP1-Main:latest", "raw", "raw-jpeg-bytes", "imgID", "frame-1")

	frameSource, err := NewFrameSource(redisconfig.Config{
		Host:      redisServer.Host(),
		Port:      redisServer.Server().Addr().Port,
		KeyPrefix: "camera",
	})
	if err != nil {
		t.Fatalf("NewFrameSource() returned error: %v", err)
	}
	defer frameSource.Close()

	frameData, imgID, err := frameSource.ReadFrame(context.Background(), "LP1-Main", LiveFrameSourceRaw)
	if err != nil {
		t.Fatalf("ReadFrame() returned error: %v", err)
	}
	if got, want := string(frameData), "raw-jpeg-bytes"; got != want {
		t.Fatalf("frameData = %q, want %q", got, want)
	}
	if got, want := imgID, "frame-1"; got != want {
		t.Fatalf("imgID = %q, want %q", got, want)
	}
}

func TestFrameSourceReadFrameProcessed(t *testing.T) {
	t.Parallel()

	redisServer := miniredis.RunT(t)
	redisServer.Set("camera:LP1-Main:processed", "processed-jpeg-bytes")
	redisServer.Set("camera:LP1-Main:processed_time", "2026-04-14T12:00:00Z")

	frameSource, err := NewFrameSource(redisconfig.Config{
		Host:      redisServer.Host(),
		Port:      redisServer.Server().Addr().Port,
		KeyPrefix: "camera",
	})
	if err != nil {
		t.Fatalf("NewFrameSource() returned error: %v", err)
	}
	defer frameSource.Close()

	frameData, imgID, err := frameSource.ReadFrame(
		context.Background(),
		"LP1-Main",
		LiveFrameSourceProcessed,
	)
	if err != nil {
		t.Fatalf("ReadFrame() returned error: %v", err)
	}
	if got, want := string(frameData), "processed-jpeg-bytes"; got != want {
		t.Fatalf("frameData = %q, want %q", got, want)
	}
	if got, want := imgID, "2026-04-14T12:00:00Z"; got != want {
		t.Fatalf("imgID = %q, want %q", got, want)
	}
}
