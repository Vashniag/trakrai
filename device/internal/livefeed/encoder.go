package livefeed

import (
	"fmt"
	"log/slog"
)

const minimumKeyframeIntervalFrames = 2

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
	enc, err := NewEncoder(hwDesc)
	if err == nil {
		if err := enc.Start(); err == nil {
			log.Info("using hardware H.264 encoder (NVENC)")
			return &H264Encoder{enc: enc, log: log}, nil
		}
		enc.Stop()
	}
	log.Warn("hardware encoder unavailable, trying software", "error", err)

	swDesc := buildSWEncoderPipeline(width, height, fps)
	enc, err = NewEncoder(swDesc)
	if err != nil {
		return nil, fmt.Errorf("no encoder available: %w", err)
	}
	if err := enc.Start(); err != nil {
		enc.Stop()
		return nil, fmt.Errorf("software encoder start: %w", err)
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
