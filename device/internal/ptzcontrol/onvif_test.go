package ptzcontrol

import "testing"

func TestBuildCapabilities(t *testing.T) {
	t.Parallel()

	capabilities := buildCapabilities(
		false,
		ptzSpaces{
			continuousPanTilt: "pan-tilt-space",
		},
		defaultPositionLimits(),
		defaultVelocityLimits(),
		false,
	)

	if !capabilities.CanContinuousPanTilt {
		t.Fatalf("expected continuous pan/tilt support")
	}
	if capabilities.CanContinuousZoom {
		t.Fatalf("did not expect continuous zoom support")
	}
	if capabilities.CanGoHome {
		t.Fatalf("did not expect home support")
	}
	if capabilities.PanRange == nil || capabilities.TiltRange == nil {
		t.Fatalf("expected pan and tilt ranges")
	}
	if capabilities.ZoomRange != nil {
		t.Fatalf("did not expect zoom range")
	}
}

func TestScaleVelocityComponent(t *testing.T) {
	t.Parallel()

	if got := scaleVelocityComponent(0.5, -60, 60); got != 30 {
		t.Fatalf("positive scale mismatch: got %v want 30", got)
	}
	if got := scaleVelocityComponent(-0.5, -40, 40); got != -20 {
		t.Fatalf("negative scale mismatch: got %v want -20", got)
	}
}

func TestNormalizedToRange(t *testing.T) {
	t.Parallel()

	if got := normalizedToRange(0.25, 10, 30); got != 15 {
		t.Fatalf("normalizedToRange = %v, want 15", got)
	}
}
