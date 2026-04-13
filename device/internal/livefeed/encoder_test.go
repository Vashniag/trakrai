package livefeed

import "testing"

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
