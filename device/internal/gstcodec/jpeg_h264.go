package gstcodec

import "fmt"

const minimumKeyframeIntervalFrames = 2

type JPEGH264Variant string

const (
	JPEGH264VariantNVJPEG JPEGH264Variant = "nvjpegdec"
	JPEGH264VariantV4L2   JPEGH264Variant = "nvv4l2decoder"
	JPEGH264VariantSW     JPEGH264Variant = "software"
)

type AppSrcCandidate struct {
	Description string
	Label       string
	Variant     JPEGH264Variant
}

type MultiFileCandidate struct {
	Args    []string
	Label   string
	Variant JPEGH264Variant
}

func KeyframeIntervalFrames(fps int) int {
	if fps < minimumKeyframeIntervalFrames {
		return minimumKeyframeIntervalFrames
	}
	return fps
}

func BuildJPEGAppSrcPipeline(variant JPEGH264Variant, width int, height int, fps int) string {
	keyframeInterval := KeyframeIntervalFrames(fps)
	switch variant {
	case JPEGH264VariantNVJPEG:
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
	case JPEGH264VariantV4L2:
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
	default:
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
}

func JPEGAppSrcCandidates(width int, height int, fps int) []AppSrcCandidate {
	return []AppSrcCandidate{
		{
			Description: BuildJPEGAppSrcPipeline(JPEGH264VariantNVJPEG, width, height, fps),
			Label:       "using hardware JPEG decode + NVENC pipeline (nvjpegdec)",
			Variant:     JPEGH264VariantNVJPEG,
		},
		{
			Description: BuildJPEGAppSrcPipeline(JPEGH264VariantV4L2, width, height, fps),
			Label:       "using hardware JPEG decode + NVENC pipeline (nvv4l2decoder)",
			Variant:     JPEGH264VariantV4L2,
		},
		{
			Description: BuildJPEGAppSrcPipeline(JPEGH264VariantSW, width, height, fps),
			Label:       "using software JPEG decode/x264 pipeline",
			Variant:     JPEGH264VariantSW,
		},
	}
}

func BuildJPEGMultiFileArgs(
	variant JPEGH264Variant,
	location string,
	outputPath string,
	width int,
	height int,
	fps int,
) []string {
	keyframeInterval := KeyframeIntervalFrames(fps)
	args := []string{
		"-q",
		"multifilesrc",
		fmt.Sprintf("location=%s", location),
		"index=0",
		fmt.Sprintf("caps=image/jpeg,framerate=%d/1", fps),
		"!",
	}
	switch variant {
	case JPEGH264VariantNVJPEG:
		args = append(args,
			"nvjpegdec",
			"!",
			"nvvidconv",
			"interpolation-method=1",
			"!",
			fmt.Sprintf("video/x-raw(memory:NVMM),format=NV12,width=%d,height=%d,framerate=%d/1", width, height, fps),
			"!",
			"nvv4l2h264enc",
			"maxperf-enable=true",
			"insert-sps-pps=true",
			fmt.Sprintf("idrinterval=%d", keyframeInterval),
			"bitrate=2000000",
		)
	case JPEGH264VariantV4L2:
		args = append(args,
			"nvv4l2decoder",
			"mjpeg=true",
			"enable-max-performance=true",
			"!",
			"nvvidconv",
			"interpolation-method=1",
			"!",
			fmt.Sprintf("video/x-raw(memory:NVMM),format=NV12,width=%d,height=%d,framerate=%d/1", width, height, fps),
			"!",
			"nvv4l2h264enc",
			"maxperf-enable=true",
			"insert-sps-pps=true",
			fmt.Sprintf("idrinterval=%d", keyframeInterval),
			"bitrate=2000000",
		)
	default:
		args = append(args,
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
			fmt.Sprintf("key-int-max=%d", keyframeInterval),
		)
	}
	args = append(args,
		"!",
		"h264parse",
		"!",
		"mp4mux",
		"faststart=true",
		"!",
		"filesink",
		fmt.Sprintf("location=%s", outputPath),
		"sync=false",
	)
	return args
}

func JPEGMultiFileCandidates(location string, outputPath string, width int, height int, fps int) []MultiFileCandidate {
	return []MultiFileCandidate{
		{
			Args:    BuildJPEGMultiFileArgs(JPEGH264VariantNVJPEG, location, outputPath, width, height, fps),
			Label:   "using hardware JPEG decode + NVENC clip pipeline (nvjpegdec)",
			Variant: JPEGH264VariantNVJPEG,
		},
		{
			Args:    BuildJPEGMultiFileArgs(JPEGH264VariantV4L2, location, outputPath, width, height, fps),
			Label:   "using hardware JPEG decode + NVENC clip pipeline (nvv4l2decoder)",
			Variant: JPEGH264VariantV4L2,
		},
		{
			Args:    BuildJPEGMultiFileArgs(JPEGH264VariantSW, location, outputPath, width, height, fps),
			Label:   "using software JPEG decode/x264 clip pipeline",
			Variant: JPEGH264VariantSW,
		},
	}
}
