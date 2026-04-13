package livefeed

import (
	"fmt"
	"log/slog"
)

type H264Encoder struct {
	enc *Encoder
	log *slog.Logger
}

func buildHWEncoderPipeline(fps int) string {
	return fmt.Sprintf(
		"appsrc name=src is-live=true format=time caps=image/jpeg,framerate=%d/1 "+
			"! jpegdec "+
			"! nvvidconv "+
			"! nvv4l2h264enc maxperf-enable=true insert-sps-pps=true idrinterval=30 bitrate=2000000 "+
			"! h264parse config-interval=1 "+
			"! video/x-h264,stream-format=byte-stream "+
			"! appsink name=sink max-buffers=4 drop=true sync=false emit-signals=false",
		fps,
	)
}

func buildSWEncoderPipeline(fps int) string {
	return fmt.Sprintf(
		"appsrc name=src is-live=true format=time caps=image/jpeg,framerate=%d/1 "+
			"! jpegdec "+
			"! videoconvert "+
			"! x264enc tune=zerolatency speed-preset=ultrafast bitrate=2000 key-int-max=30 "+
			"! h264parse config-interval=1 "+
			"! video/x-h264,stream-format=byte-stream "+
			"! appsink name=sink max-buffers=4 drop=true sync=false emit-signals=false",
		fps,
	)
}

func NewH264Encoder(fps int) (*H264Encoder, error) {
	log := slog.With("component", "encoder")

	hwDesc := buildHWEncoderPipeline(fps)
	enc, err := NewEncoder(hwDesc)
	if err == nil {
		if err := enc.Start(); err == nil {
			log.Info("using hardware H.264 encoder (NVENC)")
			return &H264Encoder{enc: enc, log: log}, nil
		}
		enc.Stop()
	}
	log.Warn("hardware encoder unavailable, trying software", "error", err)

	swDesc := buildSWEncoderPipeline(fps)
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

func (e *H264Encoder) Encode(jpeg []byte, ptsNs uint64) ([]byte, error) {
	if err := e.enc.PushFrame(jpeg, ptsNs); err != nil {
		return nil, err
	}
	return e.enc.PullPacket(500_000_000)
}

func (e *H264Encoder) Stop() {
	e.enc.Stop()
}
