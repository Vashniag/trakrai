package livefeed

import (
	"image"
	"strings"
	"testing"
)

func TestBuildHardwareCompositePipeline(t *testing.T) {
	t.Parallel()

	regions := []compositeRegion{
		{Bounds: image.Rect(8, 8, 472, 270), CameraName: "A", Primary: true},
		{Bounds: image.Rect(480, 8, 944, 270), CameraName: "B", Primary: false},
	}

	pipeline := buildHardwareCompositePipeline(CompositeConfig{
		Width:       960,
		Height:      540,
		TilePadding: 8,
	}, regions, 10)

	requiredFragments := []string{
		"nvcompositor name=comp",
		"sink_0::xpos=8",
		"sink_1::xpos=480",
		"appsrc name=src0",
		"appsrc name=src1",
		"nvjpegdec",
		"nvv4l2h264enc",
	}

	for _, fragment := range requiredFragments {
		if !strings.Contains(pipeline, fragment) {
			t.Fatalf("buildHardwareCompositePipeline() missing %q in %q", fragment, pipeline)
		}
	}
}

func TestBuildSoftwareCompositePipeline(t *testing.T) {
	t.Parallel()

	regions := []compositeRegion{
		{Bounds: image.Rect(8, 8, 952, 532), CameraName: "A", Primary: true},
	}

	pipeline := buildSoftwareCompositePipeline(CompositeConfig{
		Width:       960,
		Height:      540,
		TilePadding: 8,
	}, regions, 10)

	requiredFragments := []string{
		"compositor name=comp",
		"jpegdec",
		"x264enc",
	}

	for _, fragment := range requiredFragments {
		if !strings.Contains(pipeline, fragment) {
			t.Fatalf("buildSoftwareCompositePipeline() missing %q in %q", fragment, pipeline)
		}
	}
}

func TestNativePlanSignature(t *testing.T) {
	t.Parallel()

	left := nativePlanSignature(LiveLayoutPlan{
		CameraNames: []string{"A", "B"},
		FrameSource: LiveFrameSourceProcessed,
		Mode:        LiveLayoutGrid4,
	})
	right := nativePlanSignature(LiveLayoutPlan{
		CameraNames: []string{"A", "B", "C"},
		FrameSource: LiveFrameSourceProcessed,
		Mode:        LiveLayoutGrid4,
	})

	if left == right {
		t.Fatalf("nativePlanSignature() should change when the camera set changes")
	}
}
