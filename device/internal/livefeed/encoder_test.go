package livefeed

import (
	"strings"
	"testing"
)

func TestKeyframeIntervalFrames(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		fps  int
		want int
	}{
		{fps: 0, want: minimumKeyframeIntervalFrames},
		{fps: 1, want: minimumKeyframeIntervalFrames},
		{fps: 2, want: 2},
		{fps: 10, want: 10},
	}

	for _, testCase := range testCases {
		if got := keyframeIntervalFrames(testCase.fps); got != testCase.want {
			t.Fatalf("keyframeIntervalFrames(%d) = %d, want %d", testCase.fps, got, testCase.want)
		}
	}
}

func TestBuildHWJPEGEncoderPipeline(t *testing.T) {
	t.Parallel()

	pipeline := buildHWJPEGEncoderPipeline(960, 540, 10)
	requiredFragments := []string{
		"caps=image/jpeg,framerate=10/1",
		"nvjpegdec",
		"nvvidconv",
		"video/x-raw(memory:NVMM),format=NV12,width=960,height=540,framerate=10/1",
		"nvv4l2h264enc",
	}

	for _, fragment := range requiredFragments {
		if !strings.Contains(pipeline, fragment) {
			t.Fatalf("buildHWJPEGEncoderPipeline() missing %q in %q", fragment, pipeline)
		}
	}
}

func TestFramePumpModeForPlan(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name string
		plan LiveLayoutPlan
		want framePumpMode
	}{
		{
			name: "single camera uses jpeg fast path",
			plan: LiveLayoutPlan{
				CameraNames: []string{"LP1-Main"},
				FrameSource: LiveFrameSourceRaw,
				Mode:        LiveLayoutSingle,
			},
			want: framePumpModeSingleJPEG,
		},
		{
			name: "grid layout uses compositor path",
			plan: LiveLayoutPlan{
				CameraNames: []string{"LP1-Main", "LP2-Main"},
				FrameSource: LiveFrameSourceRaw,
				Mode:        LiveLayoutGrid4,
			},
			want: framePumpModeCompositeRGBA,
		},
		{
			name: "multi camera single falls back to compositor path",
			plan: LiveLayoutPlan{
				CameraNames: []string{"LP1-Main", "LP2-Main"},
				FrameSource: LiveFrameSourceProcessed,
				Mode:        LiveLayoutSingle,
			},
			want: framePumpModeCompositeRGBA,
		},
	}

	for _, testCase := range testCases {
		if got := framePumpModeForPlan(testCase.plan); got != testCase.want {
			t.Fatalf("%s: framePumpModeForPlan() = %q, want %q", testCase.name, got, testCase.want)
		}
	}
}
