package livefeed

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"log/slog"
	"strings"
)

const nativePipelinePacketTimeoutNs = 500_000_000

type nativePipelineCandidate struct {
	desc  string
	label string
}

type NativeCompositePipeline struct {
	cfg         *Config
	currentPlan LiveLayoutPlan
	encoder     *MultiSourceEncoder
	fps         int
	frameSrc    *FrameSource
	lastFrames  map[string][]byte
	log         *slog.Logger
	placeholder []byte
	signature   string
}

func NewNativeCompositePipeline(cfg *Config, frameSrc *FrameSource, fps int) (*NativeCompositePipeline, error) {
	placeholder, err := buildPlaceholderJPEG()
	if err != nil {
		return nil, err
	}

	return &NativeCompositePipeline{
		cfg:         cfg,
		fps:         fps,
		frameSrc:    frameSrc,
		lastFrames:  make(map[string][]byte),
		log:         slog.With("component", "native-pipeline"),
		placeholder: placeholder,
	}, nil
}

func (np *NativeCompositePipeline) EncodeFrames(
	ctx context.Context,
	plan LiveLayoutPlan,
	ptsNs uint64,
) ([]byte, error) {
	if err := np.ensurePlan(plan); err != nil {
		return nil, err
	}

	for index, cameraName := range plan.CameraNames {
		frameData := np.readFrame(ctx, cameraName, plan.FrameSource)
		if err := np.encoder.PushFrame(index, frameData, ptsNs); err != nil {
			return nil, fmt.Errorf("push frame for %s: %w", cameraName, err)
		}
	}

	packet, err := np.encoder.PullPacket(nativePipelinePacketTimeoutNs)
	if err != nil {
		return nil, fmt.Errorf("pull packet: %w", err)
	}

	return packet, nil
}

func (np *NativeCompositePipeline) Stop() {
	if np.encoder != nil {
		np.encoder.Stop()
		np.encoder = nil
	}
}

func (np *NativeCompositePipeline) ensurePlan(plan LiveLayoutPlan) error {
	signature := nativePlanSignature(plan)
	if np.encoder != nil && np.signature == signature {
		return nil
	}

	np.Stop()

	candidates := nativePipelineCandidates(np.cfg, plan, np.fps)
	var lastErr error
	for _, candidate := range candidates {
		encoder, err := NewMultiSourceEncoder(candidate.desc, len(plan.CameraNames))
		if err != nil {
			lastErr = err
			np.log.Warn("native pipeline candidate unavailable, trying fallback",
				"cameraCount", len(plan.CameraNames),
				"frameSource", plan.FrameSource,
				"layoutMode", plan.Mode,
				"candidate", candidate.label,
				"error", err,
			)
			continue
		}

		if err := encoder.Start(); err != nil {
			lastErr = err
			encoder.Stop()
			np.log.Warn("native pipeline candidate failed to start, trying fallback",
				"candidate", candidate.label,
				"error", err,
			)
			continue
		}

		np.currentPlan = plan
		np.encoder = encoder
		np.signature = signature
		np.log.Info("using native live-feed pipeline",
			"candidate", candidate.label,
			"cameraCount", len(plan.CameraNames),
			"frameSource", plan.FrameSource,
			"layoutMode", plan.Mode,
		)
		return nil
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("no native pipeline candidates were generated")
	}

	return lastErr
}

func (np *NativeCompositePipeline) readFrame(
	ctx context.Context,
	cameraName string,
	frameSource LiveFrameSource,
) []byte {
	frameData, _, err := np.frameSrc.ReadFrame(ctx, cameraName, frameSource)
	if err == nil && len(frameData) > 0 {
		cloned := bytes.Clone(frameData)
		np.lastFrames[cameraName] = cloned
		return cloned
	}

	if cached := np.lastFrames[cameraName]; len(cached) > 0 {
		return cached
	}

	return np.placeholder
}

func nativePlanSignature(plan LiveLayoutPlan) string {
	return fmt.Sprintf("%s|%s|%s",
		plan.Mode,
		plan.FrameSource,
		strings.Join(plan.CameraNames, ","),
	)
}

func nativePipelineCandidates(cfg *Config, plan LiveLayoutPlan, fps int) []nativePipelineCandidate {
	regions := compositeRegions(cfg.Composite.Width, cfg.Composite.Height, cfg.Composite.TilePadding, plan)
	if len(regions) == 0 {
		return nil
	}

	candidates := make([]nativePipelineCandidate, 0, 2)

	if cfg.NativePipeline.JPEGDecoder != "software" && cfg.NativePipeline.Encoder != "software" {
		candidates = append(candidates, nativePipelineCandidate{
			desc:  buildHardwareCompositePipeline(cfg.Composite, regions, fps),
			label: "hardware",
		})
	}

	if cfg.NativePipeline.JPEGDecoder != "hardware" && cfg.NativePipeline.Encoder != "hardware" {
		candidates = append(candidates, nativePipelineCandidate{
			desc:  buildSoftwareCompositePipeline(cfg.Composite, regions, fps),
			label: "software",
		})
	}

	if len(candidates) == 0 && cfg.NativePipeline.Encoder == "auto" && cfg.NativePipeline.JPEGDecoder == "auto" {
		candidates = append(candidates, nativePipelineCandidate{
			desc:  buildHardwareCompositePipeline(cfg.Composite, regions, fps),
			label: "hardware",
		})
		candidates = append(candidates, nativePipelineCandidate{
			desc:  buildSoftwareCompositePipeline(cfg.Composite, regions, fps),
			label: "software",
		})
	}

	return candidates
}

func buildHardwareCompositePipeline(
	composite CompositeConfig,
	regions []compositeRegion,
	fps int,
) string {
	keyframeInterval := keyframeIntervalFrames(fps)
	parts := []string{
		buildNVCompositorHead(regions),
		fmt.Sprintf(
			`! queue ! nvvidconv ! video/x-raw(memory:NVMM),format=NV12,width=%d,height=%d,framerate=%d/1 `+
				`! nvv4l2h264enc maxperf-enable=true insert-sps-pps=true idrinterval=%d bitrate=2000000 `+
				`! h264parse config-interval=1 ! video/x-h264,stream-format=byte-stream `+
				`! appsink name=sink max-buffers=4 drop=true sync=false emit-signals=false`,
			composite.Width,
			composite.Height,
			fps,
			keyframeInterval,
		),
	}

	for index := range regions {
		parts = append(parts, fmt.Sprintf(
			`appsrc name=src%d is-live=true block=true format=time caps=image/jpeg,framerate=%d/1 `+
				`! queue max-size-buffers=1 leaky=downstream `+
				`! nvjpegdec ! nvvidconv interpolation-method=1 `+
				`! video/x-raw(memory:NVMM),format=RGBA ! comp.sink_%d`,
			index,
			fps,
			index,
		))
	}

	return strings.Join(parts, " ")
}

func buildSoftwareCompositePipeline(
	composite CompositeConfig,
	regions []compositeRegion,
	fps int,
) string {
	keyframeInterval := keyframeIntervalFrames(fps)
	parts := []string{
		buildSoftwareCompositorHead(regions),
		fmt.Sprintf(
			`! queue ! videoconvert ! video/x-raw,format=I420,width=%d,height=%d,framerate=%d/1 `+
				`! x264enc tune=zerolatency speed-preset=ultrafast bitrate=2000 key-int-max=%d `+
				`! h264parse config-interval=1 ! video/x-h264,stream-format=byte-stream `+
				`! appsink name=sink max-buffers=4 drop=true sync=false emit-signals=false`,
			composite.Width,
			composite.Height,
			fps,
			keyframeInterval,
		),
	}

	for index := range regions {
		parts = append(parts, fmt.Sprintf(
			`appsrc name=src%d is-live=true block=true format=time caps=image/jpeg,framerate=%d/1 `+
				`! queue max-size-buffers=1 leaky=downstream `+
				`! jpegdec ! videoconvert ! video/x-raw,format=RGBA ! comp.sink_%d`,
			index,
			fps,
			index,
		))
	}

	return strings.Join(parts, " ")
}

func buildNVCompositorHead(regions []compositeRegion) string {
	parts := []string{"nvcompositor name=comp"}
	for index, region := range regions {
		parts = append(parts,
			fmt.Sprintf("sink_%d::xpos=%d", index, region.Bounds.Min.X),
			fmt.Sprintf("sink_%d::ypos=%d", index, region.Bounds.Min.Y),
			fmt.Sprintf("sink_%d::width=%d", index, region.Bounds.Dx()),
			fmt.Sprintf("sink_%d::height=%d", index, region.Bounds.Dy()),
		)
	}

	return strings.Join(parts, " ")
}

func buildSoftwareCompositorHead(regions []compositeRegion) string {
	parts := []string{"compositor name=comp background=black"}
	for index, region := range regions {
		parts = append(parts,
			fmt.Sprintf("sink_%d::xpos=%d", index, region.Bounds.Min.X),
			fmt.Sprintf("sink_%d::ypos=%d", index, region.Bounds.Min.Y),
			fmt.Sprintf("sink_%d::width=%d", index, region.Bounds.Dx()),
			fmt.Sprintf("sink_%d::height=%d", index, region.Bounds.Dy()),
		)
	}

	return strings.Join(parts, " ")
}

func buildPlaceholderJPEG() ([]byte, error) {
	imageBuffer := image.NewRGBA(image.Rect(0, 0, 64, 64))
	fillRect(imageBuffer, imageBuffer.Bounds(), color.RGBA{R: 8, G: 12, B: 18, A: 255})

	var out bytes.Buffer
	if err := jpeg.Encode(&out, imageBuffer, &jpeg.Options{Quality: 80}); err != nil {
		return nil, fmt.Errorf("encode placeholder jpeg: %w", err)
	}

	return out.Bytes(), nil
}
