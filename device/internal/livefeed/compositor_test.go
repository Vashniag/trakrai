package livefeed

import (
	"image"
	"testing"
)

func TestCompositeRegionsGrid4(t *testing.T) {
	t.Parallel()

	plan := LiveLayoutPlan{
		Mode:        LiveLayoutGrid4,
		CameraNames: []string{"A", "B", "C", "D"},
	}

	regions := compositeRegions(960, 540, 8, plan)
	if len(regions) != 4 {
		t.Fatalf("compositeRegions returned %d regions, want 4", len(regions))
	}

	if !regions[0].Primary {
		t.Fatal("first region should be primary")
	}

	for index, region := range regions {
		if region.Bounds.Empty() {
			t.Fatalf("region %d is empty", index)
		}
	}
}

func TestCompositeRegionsFocus8(t *testing.T) {
	t.Parallel()

	plan := LiveLayoutPlan{
		Mode:        LiveLayoutFocus8,
		CameraNames: []string{"A", "B", "C", "D", "E", "F", "G", "H"},
	}

	regions := compositeRegions(1280, 720, 8, plan)
	if len(regions) != 8 {
		t.Fatalf("compositeRegions returned %d regions, want 8", len(regions))
	}

	if !regions[0].Primary {
		t.Fatal("focus layout should mark the first region as primary")
	}

	primaryArea := regions[0].Bounds.Dx() * regions[0].Bounds.Dy()
	secondaryArea := regions[1].Bounds.Dx() * regions[1].Bounds.Dy()
	if primaryArea <= secondaryArea {
		t.Fatalf("focus layout primary area = %d, want greater than %d", primaryArea, secondaryArea)
	}
}

func TestFitRectPreservesAspectRatio(t *testing.T) {
	t.Parallel()

	target := fitRect(1920, 1080, image.Rect(0, 0, 320, 320))
	if got, want := target.Dx(), 320; got != want {
		t.Fatalf("fitRect width = %d, want %d", got, want)
	}
	if got, want := target.Dy(), 180; got != want {
		t.Fatalf("fitRect height = %d, want %d", got, want)
	}
	if got, want := target.Min.Y, 70; got != want {
		t.Fatalf("fitRect Y offset = %d, want %d", got, want)
	}
}
