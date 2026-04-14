package livefeed

import (
	"reflect"
	"testing"
)

func TestNormalizeLiveLayoutPlan(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		cameraName  string
		cameraNames []string
		frameSource string
		mode        string
		want        LiveLayoutPlan
	}{
		{
			cameraName:  "LP1-Main",
			cameraNames: []string{"LP1-Main", "LP1-Sec", "LP2-Main"},
			frameSource: string(LiveFrameSourceProcessed),
			mode:        string(LiveLayoutGrid4),
			want: LiveLayoutPlan{
				Mode:        LiveLayoutGrid4,
				CameraNames: []string{"LP1-Main", "LP1-Sec", "LP2-Main"},
				FrameSource: LiveFrameSourceProcessed,
			},
		},
		{
			cameraName:  " LP1-Main ",
			cameraNames: []string{"LP1-Main", "LP1-Sec", "LP2-Main", "LP2-Main"},
			frameSource: "unsupported",
			mode:        "unsupported",
			want: LiveLayoutPlan{
				Mode:        LiveLayoutSingle,
				CameraNames: []string{"LP1-Main"},
				FrameSource: LiveFrameSourceRaw,
			},
		},
		{
			cameraName:  "",
			cameraNames: []string{"A", "B", "C", "D", "E"},
			frameSource: string(LiveFrameSourceRaw),
			mode:        string(LiveLayoutGrid4),
			want: LiveLayoutPlan{
				Mode:        LiveLayoutGrid4,
				CameraNames: []string{"A", "B", "C", "D"},
				FrameSource: LiveFrameSourceRaw,
			},
		},
	}

	for _, testCase := range testCases {
		got, err := NormalizeLiveLayoutPlan(
			testCase.mode,
			testCase.cameraName,
			testCase.cameraNames,
			testCase.frameSource,
		)
		if err != nil {
			t.Fatalf("NormalizeLiveLayoutPlan returned error: %v", err)
		}

		if !reflect.DeepEqual(got, testCase.want) {
			t.Fatalf("NormalizeLiveLayoutPlan() = %#v, want %#v", got, testCase.want)
		}
	}
}

func TestNormalizeLiveLayoutPlanRequiresCamera(t *testing.T) {
	t.Parallel()

	if _, err := NormalizeLiveLayoutPlan(string(LiveLayoutGrid4), "", nil, string(LiveFrameSourceRaw)); err == nil {
		t.Fatal("NormalizeLiveLayoutPlan should require at least one camera")
	}
}
