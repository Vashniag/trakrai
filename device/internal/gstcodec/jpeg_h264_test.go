package gstcodec

import (
	"strings"
	"testing"
)

func TestBuildJPEGAppSrcPipelineForH264(t *testing.T) {
	pipeline := BuildJPEGAppSrcPipelineForCodec(VideoCodecH264, JPEGH264VariantNVJPEG, 960, 540, 10)
	requiredFragments := []string{
		"caps=image/jpeg,framerate=10/1",
		"nvjpegdec",
		"nvv4l2h264enc",
		"h264parse",
		"video/x-h264,stream-format=byte-stream",
	}
	for _, fragment := range requiredFragments {
		if !strings.Contains(pipeline, fragment) {
			t.Fatalf("BuildJPEGAppSrcPipelineForCodec(h264) missing %q in %q", fragment, pipeline)
		}
	}
}

func TestBuildJPEGAppSrcPipelineForH265(t *testing.T) {
	pipeline := BuildJPEGAppSrcPipelineForCodec(VideoCodecH265, JPEGH264VariantV4L2, 960, 540, 10)
	requiredFragments := []string{
		"caps=image/jpeg,framerate=10/1",
		"nvv4l2decoder",
		"nvv4l2h265enc",
		"h265parse",
		"video/x-h265,stream-format=byte-stream",
	}
	for _, fragment := range requiredFragments {
		if !strings.Contains(pipeline, fragment) {
			t.Fatalf("BuildJPEGAppSrcPipelineForCodec(h265) missing %q in %q", fragment, pipeline)
		}
	}
}
