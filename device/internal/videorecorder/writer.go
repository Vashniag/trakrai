package videorecorder

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

type clipWriter interface {
	WriteJPEGSequence(ctx context.Context, outputPath string, width int, height int, fps int, frames [][]byte) error
}

type gstreamerWriter struct {
	bin string
	log *slog.Logger
}

func newClipWriter(bin string, logger *slog.Logger) clipWriter {
	return &gstreamerWriter{
		bin: bin,
		log: logger,
	}
}

func (w *gstreamerWriter) WriteJPEGSequence(
	ctx context.Context,
	outputPath string,
	width int,
	height int,
	fps int,
	frames [][]byte,
) error {
	if len(frames) == 0 {
		return fmt.Errorf("at least one frame is required")
	}
	if fps <= 0 {
		return fmt.Errorf("fps must be greater than 0")
	}
	if width <= 0 || height <= 0 {
		return fmt.Errorf("invalid output resolution %dx%d", width, height)
	}

	outputDir := filepath.Dir(outputPath)
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}

	tempDir, err := os.MkdirTemp(outputDir, ".video-recorder-frames-*")
	if err != nil {
		return fmt.Errorf("create temporary frame directory: %w", err)
	}
	defer os.RemoveAll(tempDir)

	for index, frame := range frames {
		framePath := filepath.Join(tempDir, fmt.Sprintf("frame-%06d.jpg", index))
		if err := os.WriteFile(framePath, frame, 0o644); err != nil {
			return fmt.Errorf("write temporary frame %d: %w", index, err)
		}
	}

	tempOutput, err := os.CreateTemp(outputDir, ".video-recorder-output-*.mp4")
	if err != nil {
		return fmt.Errorf("create temporary output file: %w", err)
	}
	tempOutputPath := tempOutput.Name()
	_ = tempOutput.Close()
	defer os.Remove(tempOutputPath)

	args := []string{
		"-q",
		"multifilesrc",
		fmt.Sprintf("location=%s", filepath.Join(tempDir, "frame-%06d.jpg")),
		"index=0",
		fmt.Sprintf("caps=image/jpeg,framerate=%d/1", fps),
		"!",
		"jpegdec",
		"!",
		"videoconvert",
		"!",
		"videoscale",
		"!",
		fmt.Sprintf("video/x-raw,format=I420,width=%d,height=%d,framerate=%d/1", width, height, fps),
		"!",
		"x264enc",
		"tune=zerolatency",
		"speed-preset=ultrafast",
		"bitrate=2000",
		fmt.Sprintf("key-int-max=%d", maxInt(2, fps)),
		"!",
		"h264parse",
		"!",
		"mp4mux",
		"faststart=true",
		"!",
		"filesink",
		fmt.Sprintf("location=%s", tempOutputPath),
		"sync=false",
	}

	command := exec.CommandContext(ctx, w.bin, args...)
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("gstreamer encode failed: %w: %s", err, string(output))
	}

	if err := os.Rename(tempOutputPath, outputPath); err != nil {
		return fmt.Errorf("move encoded clip into place: %w", err)
	}
	w.log.Debug("encoded clip", "output", outputPath, "frames", len(frames), "duration_sec", time.Duration(len(frames))*time.Second/time.Duration(fps))
	return nil
}

func maxInt(left int, right int) int {
	if left > right {
		return left
	}
	return right
}
