package roiconfig

import (
	"path/filepath"
	"testing"
	"time"
)

func TestSaveAndLoadDocument(t *testing.T) {
	t.Parallel()

	filePath := filepath.Join(t.TempDir(), "roi-config.json")
	document := Document{
		Cameras: []CameraROIConfig{
			{
				CameraName: "Camera-1",
				BaseLocations: []BaseLocation{
					{
						Active: true,
						Name:   "Dock",
						PTZ: PTZPosition{
							Pan:  2,
							Tilt: -2,
							Zoom: 3,
						},
						ROIs: []ROIBoxSpec{
							{
								Active: true,
								Name:   "Entrance",
								Bounds: ROIBox{
									X:      -0.1,
									Y:      0.2,
									Width:  0.9,
									Height: 0.9,
								},
							},
						},
					},
				},
			},
		},
	}

	if err := saveDocument(filePath, document, time.Date(2026, 4, 16, 10, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("saveDocument failed: %v", err)
	}

	loaded, err := loadDocument(filePath)
	if err != nil {
		t.Fatalf("loadDocument failed: %v", err)
	}

	if loaded.Version != documentVersion {
		t.Fatalf("expected version %d, got %d", documentVersion, loaded.Version)
	}
	if len(loaded.Cameras) != 1 || loaded.Cameras[0].CameraName != "Camera-1" {
		t.Fatalf("unexpected cameras: %#v", loaded.Cameras)
	}

	base := loaded.Cameras[0].BaseLocations[0]
	if base.PTZ.Pan != 1 || base.PTZ.Tilt != -1 || base.PTZ.Zoom != 1 {
		t.Fatalf("unexpected clamped PTZ: %#v", base.PTZ)
	}
	if base.ID == "" {
		t.Fatalf("expected base id to be generated")
	}

	roi := base.ROIs[0]
	if roi.ID == "" {
		t.Fatalf("expected ROI id to be generated")
	}
	if roi.Bounds.X != 0 || roi.Bounds.Y != 0.2 || roi.Bounds.Width != 0.9 || roi.Bounds.Height != 0.8 {
		t.Fatalf("unexpected normalized bounds: %#v", roi.Bounds)
	}
}

func TestNormalizeDocumentRejectsDuplicateCameraNames(t *testing.T) {
	t.Parallel()

	_, err := normalizeDocument(
		Document{
			Cameras: []CameraROIConfig{
				{CameraName: "Camera-1"},
				{CameraName: "camera-1"},
			},
		},
		time.Now().UTC().Format(time.RFC3339),
	)
	if err == nil {
		t.Fatalf("expected duplicate camera validation error")
	}
}
