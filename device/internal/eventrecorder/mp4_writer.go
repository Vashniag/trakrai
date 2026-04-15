package eventrecorder

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/trakrai/device-services/internal/livefeed"
)

const recorderFinalizeTimeout = 30 * time.Second

type clipWriter struct {
	cfg *Config
	log *slog.Logger
}

func newClipWriter(cfg *Config) *clipWriter {
	return &clipWriter{
		cfg: cfg,
		log: slog.With("component", ServiceName, "part", "writer"),
	}
}

func (w *clipWriter) WriteJPEGClip(outputPath string, jpegFrames [][]byte, playbackFPS int) error {
	if len(jpegFrames) == 0 {
		return fmt.Errorf("no frames to encode")
	}

	var lastErr error
	for _, candidate := range w.pipelineCandidates(outputPath, playbackFPS) {
		writer, err := livefeed.NewPipelineWriter(candidate.pipeline)
		if err != nil {
			lastErr = err
			continue
		}

		frameDuration := time.Second / time.Duration(playbackFPS)
		var pts time.Duration
		startErr := writer.Start()
		if startErr == nil {
			for _, frame := range jpegFrames {
				if err := writer.PushFrame(frame, uint64(pts.Nanoseconds()), uint64(frameDuration.Nanoseconds())); err != nil {
					startErr = err
					break
				}
				pts += frameDuration
			}
		}
		if startErr == nil {
			startErr = writer.Finalize(uint64(recorderFinalizeTimeout.Nanoseconds()))
		}
		writer.Stop()
		if startErr != nil {
			_ = os.Remove(outputPath)
			lastErr = startErr
			w.log.Warn("clip pipeline failed, trying fallback", "pipeline", candidate.label, "error", startErr)
			continue
		}

		w.log.Info("event clip written",
			"frames", len(jpegFrames),
			"pipeline", candidate.label,
			"output", outputPath,
			"playback_fps", playbackFPS,
		)
		return nil
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("no recording pipeline candidates available")
	}
	return lastErr
}

type pipelineCandidate struct {
	label    string
	pipeline string
}

func (w *clipWriter) pipelineCandidates(outputPath string, playbackFPS int) []pipelineCandidate {
	cleanedOutput := filepath.Clean(outputPath)
	switch strings.TrimSpace(w.cfg.Output.Encoder) {
	case "hardware":
		return []pipelineCandidate{{label: "hardware", pipeline: buildHardwareClipPipeline(cleanedOutput, playbackFPS)}}
	case "software":
		return []pipelineCandidate{{label: "software", pipeline: buildSoftwareClipPipeline(cleanedOutput, playbackFPS)}}
	default:
		return []pipelineCandidate{
			{label: "hardware", pipeline: buildHardwareClipPipeline(cleanedOutput, playbackFPS)},
			{label: "software", pipeline: buildSoftwareClipPipeline(cleanedOutput, playbackFPS)},
		}
	}
}

func buildHardwareClipPipeline(outputPath string, playbackFPS int) string {
	keyframeInterval := livefeedKeyframeInterval(playbackFPS)
	return fmt.Sprintf(
		`appsrc name=src is-live=false block=true format=time caps=image/jpeg,framerate=%d/1 `+
			`! nvjpegdec ! nvvidconv interpolation-method=1 `+
			`! video/x-raw(memory:NVMM),format=NV12,framerate=%d/1 `+
			`! nvv4l2h264enc maxperf-enable=true insert-sps-pps=true idrinterval=%d bitrate=2000000 `+
			`! h264parse ! qtmux faststart=true ! filesink location="%s" sync=false`,
		playbackFPS,
		playbackFPS,
		keyframeInterval,
		outputPath,
	)
}

func buildSoftwareClipPipeline(outputPath string, playbackFPS int) string {
	keyframeInterval := livefeedKeyframeInterval(playbackFPS)
	return fmt.Sprintf(
		`appsrc name=src is-live=false block=true format=time caps=image/jpeg,framerate=%d/1 `+
			`! jpegdec ! videoconvert ! video/x-raw,format=I420,framerate=%d/1 `+
			`! x264enc tune=zerolatency speed-preset=ultrafast bitrate=2000 key-int-max=%d `+
			`! h264parse ! qtmux faststart=true ! filesink location="%s" sync=false`,
		playbackFPS,
		playbackFPS,
		keyframeInterval,
		outputPath,
	)
}

func livefeedKeyframeInterval(fps int) int {
	if fps < 2 {
		return 2
	}
	return fps
}
