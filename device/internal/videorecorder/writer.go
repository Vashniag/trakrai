package videorecorder

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/trakrai/device-services/internal/gstcodec"
)

type clipWriter interface {
	WriteJPEGSequence(ctx context.Context, outputPath string, width int, height int, fps int, codec gstcodec.VideoCodec, frames [][]byte) error
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
	codec gstcodec.VideoCodec,
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

	framePattern := filepath.Join(tempDir, "frame-%06d.jpg")
	var lastErr error
	for index, candidate := range gstcodec.JPEGMultiFileCandidatesForCodec(codec, framePattern, tempOutputPath, width, height, fps) {
		command := exec.CommandContext(ctx, w.bin, candidate.Args...)
		output, err := command.CombinedOutput()
		if err == nil {
			w.log.Debug("encoded clip", "output", outputPath, "frames", len(frames), "duration_sec", time.Duration(len(frames))*time.Second/time.Duration(fps), "pipeline", candidate.Label)
			if err := os.Rename(tempOutputPath, outputPath); err != nil {
				return fmt.Errorf("move encoded clip into place: %w", err)
			}
			return nil
		}
		lastErr = fmt.Errorf("%s: %w: %s", candidate.Label, err, string(output))
		if index < 2 {
			w.log.Warn("video clip pipeline unavailable, trying fallback", "pipeline", candidate.Label, "error", err)
		}
	}
	return fmt.Errorf("gstreamer encode failed: %w", lastErr)
}
