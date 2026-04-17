package gstcodec

import (
	"fmt"
	"strings"
)

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
	return BuildJPEGAppSrcPipelineForCodec(VideoCodecH264, variant, width, height, fps)
}

func BuildJPEGAppSrcPipelineForCodec(codec VideoCodec, variant JPEGH264Variant, width int, height int, fps int) string {
	keyframeInterval := KeyframeIntervalFrames(fps)
	encoderElement, parserElement, mediaCaps := codecElements(codec, keyframeInterval)
	switch variant {
	case JPEGH264VariantNVJPEG:
		return fmt.Sprintf(
			"appsrc name=src is-live=true block=true format=time caps=image/jpeg,framerate=%d/1 "+
				"! nvjpegdec "+
				"! nvvidconv interpolation-method=1 "+
				"! video/x-raw(memory:NVMM),format=NV12,width=%d,height=%d,framerate=%d/1 "+
				"! %s "+
				"! %s "+
				"! %s "+
				"! appsink name=sink max-buffers=4 drop=true sync=false emit-signals=false",
			fps,
			width,
			height,
			fps,
			encoderElement,
			parserElement,
			mediaCaps,
		)
	case JPEGH264VariantV4L2:
		return fmt.Sprintf(
			"appsrc name=src is-live=true block=true format=time caps=image/jpeg,framerate=%d/1 "+
				"! nvv4l2decoder mjpeg=true enable-max-performance=true "+
				"! nvvidconv interpolation-method=1 "+
				"! video/x-raw(memory:NVMM),format=NV12,width=%d,height=%d,framerate=%d/1 "+
				"! %s "+
				"! %s "+
				"! %s "+
				"! appsink name=sink max-buffers=4 drop=true sync=false emit-signals=false",
			fps,
			width,
			height,
			fps,
			encoderElement,
			parserElement,
			mediaCaps,
		)
	default:
		softwareEncoder := softwareEncoderElement(codec, keyframeInterval)
		return fmt.Sprintf(
			"appsrc name=src is-live=true block=true format=time caps=image/jpeg,framerate=%d/1 "+
				"! jpegdec "+
				"! videoconvert "+
				"! videoscale "+
				"! video/x-raw,format=I420,width=%d,height=%d,framerate=%d/1 "+
				"! %s "+
				"! %s "+
				"! %s "+
				"! appsink name=sink max-buffers=4 drop=true sync=false emit-signals=false",
			fps,
			width,
			height,
			fps,
			softwareEncoder,
			parserElement,
			mediaCaps,
		)
	}
}

func JPEGAppSrcCandidates(width int, height int, fps int) []AppSrcCandidate {
	return JPEGAppSrcCandidatesForCodec(VideoCodecH264, width, height, fps)
}

func JPEGAppSrcCandidatesForCodec(codec VideoCodec, width int, height int, fps int) []AppSrcCandidate {
	codecLabel := strings.ToUpper(string(codec))
	return []AppSrcCandidate{
		{
			Description: BuildJPEGAppSrcPipelineForCodec(codec, JPEGH264VariantNVJPEG, width, height, fps),
			Label:       fmt.Sprintf("using hardware JPEG decode + NVENC %s pipeline (nvjpegdec)", codecLabel),
			Variant:     JPEGH264VariantNVJPEG,
		},
		{
			Description: BuildJPEGAppSrcPipelineForCodec(codec, JPEGH264VariantV4L2, width, height, fps),
			Label:       fmt.Sprintf("using hardware JPEG decode + NVENC %s pipeline (nvv4l2decoder)", codecLabel),
			Variant:     JPEGH264VariantV4L2,
		},
		{
			Description: BuildJPEGAppSrcPipelineForCodec(codec, JPEGH264VariantSW, width, height, fps),
			Label:       fmt.Sprintf("using software JPEG decode/%s pipeline", strings.ToLower(codecLabel)),
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
	return BuildJPEGMultiFileArgsForCodec(VideoCodecH264, variant, location, outputPath, width, height, fps)
}

func BuildJPEGMultiFileArgsForCodec(
	codec VideoCodec,
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
		hardwareEncoder := hardwareEncoderElement(codec, keyframeInterval)
		args = append(args,
			"nvjpegdec",
			"!",
			"nvvidconv",
			"interpolation-method=1",
			"!",
			fmt.Sprintf("video/x-raw(memory:NVMM),format=NV12,width=%d,height=%d,framerate=%d/1", width, height, fps),
			"!",
		)
		args = append(args, hardwareEncoder...)
	case JPEGH264VariantV4L2:
		hardwareEncoder := hardwareEncoderElement(codec, keyframeInterval)
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
		)
		args = append(args, hardwareEncoder...)
	default:
		softwareEncoder := softwareEncoderArgs(codec, keyframeInterval)
		args = append(args,
			"jpegdec",
			"!",
			"videoconvert",
			"!",
			"videoscale",
			"!",
			fmt.Sprintf("video/x-raw,format=I420,width=%d,height=%d,framerate=%d/1", width, height, fps),
			"!",
		)
		args = append(args, softwareEncoder...)
	}
	parserArgs := parserCLIArgs(codec)
	args = append(args, "!")
	args = append(args, parserArgs...)
	args = append(args,
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
	return JPEGMultiFileCandidatesForCodec(VideoCodecH264, location, outputPath, width, height, fps)
}

func JPEGMultiFileCandidatesForCodec(codec VideoCodec, location string, outputPath string, width int, height int, fps int) []MultiFileCandidate {
	codecLabel := strings.ToUpper(string(codec))
	return []MultiFileCandidate{
		{
			Args:    BuildJPEGMultiFileArgsForCodec(codec, JPEGH264VariantNVJPEG, location, outputPath, width, height, fps),
			Label:   fmt.Sprintf("using hardware JPEG decode + NVENC %s clip pipeline (nvjpegdec)", codecLabel),
			Variant: JPEGH264VariantNVJPEG,
		},
		{
			Args:    BuildJPEGMultiFileArgsForCodec(codec, JPEGH264VariantV4L2, location, outputPath, width, height, fps),
			Label:   fmt.Sprintf("using hardware JPEG decode + NVENC %s clip pipeline (nvv4l2decoder)", codecLabel),
			Variant: JPEGH264VariantV4L2,
		},
		{
			Args:    BuildJPEGMultiFileArgsForCodec(codec, JPEGH264VariantSW, location, outputPath, width, height, fps),
			Label:   fmt.Sprintf("using software JPEG decode/%s clip pipeline", strings.ToLower(codecLabel)),
			Variant: JPEGH264VariantSW,
		},
	}
}

func codecElements(codec VideoCodec, keyframeInterval int) (string, string, string) {
	parserElement, caps := parserAndCaps(codec)
	encoderElement := strings.Join(hardwareEncoderElement(codec, keyframeInterval), " ")
	return encoderElement, parserElement, caps
}

func parserAndCaps(codec VideoCodec) (string, string) {
	if codec == VideoCodecH265 {
		return "h265parse config-interval=1", "video/x-h265,stream-format=byte-stream"
	}
	return "h264parse config-interval=1", "video/x-h264,stream-format=byte-stream"
}

func parserCLIArgs(codec VideoCodec) []string {
	if codec == VideoCodecH265 {
		return []string{"h265parse", "config-interval=1"}
	}
	return []string{"h264parse", "config-interval=1"}
}

func hardwareEncoderElement(codec VideoCodec, keyframeInterval int) []string {
	if codec == VideoCodecH265 {
		return []string{
			"nvv4l2h265enc",
			"maxperf-enable=true",
			"insert-sps-pps=true",
			fmt.Sprintf("idrinterval=%d", keyframeInterval),
			"bitrate=2000000",
		}
	}
	return []string{
		"nvv4l2h264enc",
		"maxperf-enable=true",
		"insert-sps-pps=true",
		fmt.Sprintf("idrinterval=%d", keyframeInterval),
		"bitrate=2000000",
	}
}

func softwareEncoderElement(codec VideoCodec, keyframeInterval int) string {
	return strings.Join(softwareEncoderArgs(codec, keyframeInterval), " ")
}

func softwareEncoderArgs(codec VideoCodec, keyframeInterval int) []string {
	if codec == VideoCodecH265 {
		return []string{
			"x265enc",
			"speed-preset=ultrafast",
			"bitrate=2000",
			fmt.Sprintf("key-int-max=%d", keyframeInterval),
		}
	}
	return []string{
		"x264enc",
		"tune=zerolatency",
		"speed-preset=ultrafast",
		"bitrate=2000",
		fmt.Sprintf("key-int-max=%d", keyframeInterval),
	}
}
