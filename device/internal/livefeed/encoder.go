package livefeed

import (
	"fmt"
	"log/slog"
)

const minimumKeyframeIntervalFrames = 2

type PacketEncoder interface {
	Encode(frame []byte, ptsNs uint64) ([]byte, error)
	Stop()
}

func keyframeIntervalFrames(fps int) int {
	if fps < minimumKeyframeIntervalFrames {
		return minimumKeyframeIntervalFrames
	}

	return fps
}

type H264Encoder struct {
	enc *Encoder
	log *slog.Logger
}

type JPEGH264Encoder struct {
	enc *Encoder
	log *slog.Logger
}

func buildHWEncoderPipeline(width int, height int, fps int) string {
	keyframeInterval := keyframeIntervalFrames(fps)
	return fmt.Sprintf(
		"appsrc name=src is-live=true block=true format=time caps=video/x-raw,format=RGBA,width=%d,height=%d,framerate=%d/1 "+
			"! videoconvert "+
			"! nvvidconv "+
			"! nvv4l2h264enc maxperf-enable=true insert-sps-pps=true idrinterval=%d bitrate=2000000 "+
			"! h264parse config-interval=1 "+
			"! video/x-h264,stream-format=byte-stream "+
			"! appsink name=sink max-buffers=4 drop=true sync=false emit-signals=false",
		width,
		height,
		fps,
		keyframeInterval,
	)
}

func buildHWJPEGEncoderPipeline(width int, height int, fps int) string {
	keyframeInterval := keyframeIntervalFrames(fps)
	return fmt.Sprintf(
		"appsrc name=src is-live=true block=true format=time caps=image/jpeg,framerate=%d/1 "+
			"! nvjpegdec "+
			"! nvvidconv interpolation-method=1 "+
			"! video/x-raw(memory:NVMM),format=NV12,width=%d,height=%d,framerate=%d/1 "+
			"! nvv4l2h264enc maxperf-enable=true insert-sps-pps=true idrinterval=%d bitrate=2000000 "+
			"! h264parse config-interval=1 "+
			"! video/x-h264,stream-format=byte-stream "+
			"! appsink name=sink max-buffers=4 drop=true sync=false emit-signals=false",
		fps,
		width,
		height,
		fps,
		keyframeInterval,
	)
}

func buildHWV4L2JPEGEncoderPipeline(width int, height int, fps int) string {
	keyframeInterval := keyframeIntervalFrames(fps)
	return fmt.Sprintf(
		"appsrc name=src is-live=true block=true format=time caps=image/jpeg,framerate=%d/1 "+
			"! nvv4l2decoder mjpeg=true enable-max-performance=true "+
			"! nvvidconv interpolation-method=1 "+
			"! video/x-raw(memory:NVMM),format=NV12,width=%d,height=%d,framerate=%d/1 "+
			"! nvv4l2h264enc maxperf-enable=true insert-sps-pps=true idrinterval=%d bitrate=2000000 "+
			"! h264parse config-interval=1 "+
			"! video/x-h264,stream-format=byte-stream "+
			"! appsink name=sink max-buffers=4 drop=true sync=false emit-signals=false",
		fps,
		width,
		height,
		fps,
		keyframeInterval,
	)
}

func buildSWJPEGEncoderPipeline(width int, height int, fps int) string {
	keyframeInterval := keyframeIntervalFrames(fps)
	return fmt.Sprintf(
		"appsrc name=src is-live=true block=true format=time caps=image/jpeg,framerate=%d/1 "+
			"! jpegdec "+
			"! videoconvert "+
			"! videoscale "+
			"! video/x-raw,format=I420,width=%d,height=%d,framerate=%d/1 "+
			"! x264enc tune=zerolatency speed-preset=ultrafast bitrate=2000 key-int-max=%d "+
			"! h264parse config-interval=1 "+
			"! video/x-h264,stream-format=byte-stream "+
			"! appsink name=sink max-buffers=4 drop=true sync=false emit-signals=false",
		fps,
		width,
		height,
		fps,
		keyframeInterval,
	)
}

func startEncoder(desc string) (*Encoder, error) {
	enc, err := NewEncoder(desc)
	if err != nil {
		return nil, err
	}
	if err := enc.Start(); err != nil {
		enc.Stop()
		return nil, err
	}
	return enc, nil
}

func buildSWEncoderPipeline(width int, height int, fps int) string {
	keyframeInterval := keyframeIntervalFrames(fps)
	return fmt.Sprintf(
		"appsrc name=src is-live=true block=true format=time caps=video/x-raw,format=RGBA,width=%d,height=%d,framerate=%d/1 "+
			"! videoconvert "+
			"! x264enc tune=zerolatency speed-preset=ultrafast bitrate=2000 key-int-max=%d "+
			"! h264parse config-interval=1 "+
			"! video/x-h264,stream-format=byte-stream "+
			"! appsink name=sink max-buffers=4 drop=true sync=false emit-signals=false",
		width,
		height,
		fps,
		keyframeInterval,
	)
}

func NewH264Encoder(width int, height int, fps int) (*H264Encoder, error) {
	log := slog.With("component", "encoder")

	hwDesc := buildHWEncoderPipeline(width, height, fps)
	enc, err := startEncoder(hwDesc)
	if err == nil {
		log.Info("using hardware H.264 encoder (NVENC)")
		return &H264Encoder{enc: enc, log: log}, nil
	}
	log.Warn("hardware encoder unavailable, trying software", "error", err)

	swDesc := buildSWEncoderPipeline(width, height, fps)
	enc, err = startEncoder(swDesc)
	if err != nil {
		return nil, fmt.Errorf("no encoder available: %w", err)
	}
	log.Info("using software H.264 encoder (x264)")
	return &H264Encoder{enc: enc, log: log}, nil
}

func (e *H264Encoder) Encode(frame []byte, ptsNs uint64) ([]byte, error) {
	if err := e.enc.PushFrame(frame, ptsNs); err != nil {
		return nil, err
	}
	return e.enc.PullPacket(500_000_000)
}

func (e *H264Encoder) Stop() {
	e.enc.Stop()
}

func NewJPEGH264Encoder(width int, height int, fps int) (*JPEGH264Encoder, error) {
	log := slog.With("component", "jpeg-encoder")

	candidates := []struct {
		description string
		label       string
	}{
		{
			description: buildHWJPEGEncoderPipeline(width, height, fps),
			label:       "using hardware JPEG decode + NVENC pipeline (nvjpegdec)",
		},
		{
			description: buildHWV4L2JPEGEncoderPipeline(width, height, fps),
			label:       "using hardware JPEG decode + NVENC pipeline (nvv4l2decoder)",
		},
		{
			description: buildSWJPEGEncoderPipeline(width, height, fps),
			label:       "using software JPEG decode/x264 pipeline",
		},
	}

	var lastErr error
	for index, candidate := range candidates {
		enc, err := startEncoder(candidate.description)
		if err == nil {
			log.Info(candidate.label)
			return &JPEGH264Encoder{enc: enc, log: log}, nil
		}

		lastErr = err
		if index < len(candidates)-1 {
			log.Warn("jpeg encoder pipeline unavailable, trying fallback", "error", err)
		}
	}

	return nil, fmt.Errorf("no jpeg encoder available: %w", lastErr)
}

func (e *JPEGH264Encoder) Encode(frame []byte, ptsNs uint64) ([]byte, error) {
	if err := e.enc.PushFrame(frame, ptsNs); err != nil {
		return nil, err
	}
	return e.enc.PullPacket(500_000_000)
}

func (e *JPEGH264Encoder) Stop() {
	e.enc.Stop()
}
