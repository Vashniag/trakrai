package roiconfig

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"github.com/google/uuid"
)

const documentVersion = 1

type Document struct {
	Cameras   []CameraROIConfig `json:"cameras"`
	UpdatedAt string            `json:"updatedAt,omitempty"`
	Version   int               `json:"version"`
}

type CameraROIConfig struct {
	BaseLocations []BaseLocation `json:"baseLocations"`
	CameraName    string         `json:"cameraName"`
}

type BaseLocation struct {
	Active bool         `json:"active"`
	ID     string       `json:"id"`
	Name   string       `json:"name"`
	PTZ    PTZPosition  `json:"ptz"`
	ROIs   []ROIBoxSpec `json:"rois"`
}

type PTZPosition struct {
	Pan  float64 `json:"pan"`
	Tilt float64 `json:"tilt"`
	Zoom float64 `json:"zoom"`
}

type ROIBoxSpec struct {
	Active bool     `json:"active"`
	Bounds ROIBox   `json:"bounds"`
	Color  string   `json:"color,omitempty"`
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	Tags   []string `json:"tags,omitempty"`
}

type ROIBox struct {
	Height float64 `json:"height"`
	Width  float64 `json:"width"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
}

type StatusPayload struct {
	BaseLocationCount int    `json:"baseLocationCount"`
	CameraCount       int    `json:"cameraCount"`
	DocumentHash      string `json:"documentHash"`
	FilePath          string `json:"filePath"`
	ROIBoxCount       int    `json:"roiBoxCount"`
	UpdatedAt         string `json:"updatedAt,omitempty"`
}

type requestEnvelope struct {
	RequestID string `json:"requestId,omitempty"`
}

type getConfigPayload struct {
	Document  Document `json:"document"`
	FilePath  string   `json:"filePath"`
	RequestID string   `json:"requestId,omitempty"`
	StatusPayload
}

type saveConfigRequest struct {
	Document  Document `json:"document"`
	RequestID string   `json:"requestId,omitempty"`
}

type errorPayload struct {
	Error       string `json:"error"`
	RequestID   string `json:"requestId,omitempty"`
	RequestType string `json:"requestType,omitempty"`
}

func defaultDocument() Document {
	return Document{
		Cameras: []CameraROIConfig{},
		Version: documentVersion,
	}
}

func normalizeDocument(document Document, updatedAt string) (Document, error) {
	normalized := Document{
		Cameras: make([]CameraROIConfig, 0, len(document.Cameras)),
		Version: document.Version,
	}
	if normalized.Version <= 0 {
		normalized.Version = documentVersion
	}

	cameraNames := make(map[string]struct{}, len(document.Cameras))
	for cameraIndex, camera := range document.Cameras {
		cameraName := strings.TrimSpace(camera.CameraName)
		if cameraName == "" {
			return Document{}, fmt.Errorf("camera %d is missing cameraName", cameraIndex+1)
		}
		cameraKey := strings.ToLower(cameraName)
		if _, exists := cameraNames[cameraKey]; exists {
			return Document{}, fmt.Errorf("camera %q is duplicated", cameraName)
		}
		cameraNames[cameraKey] = struct{}{}

		baseIDs := make(map[string]struct{}, len(camera.BaseLocations))
		normalizedCamera := CameraROIConfig{
			BaseLocations: make([]BaseLocation, 0, len(camera.BaseLocations)),
			CameraName:    cameraName,
		}

		for baseIndex, baseLocation := range camera.BaseLocations {
			baseID := normalizeIdentifier(baseLocation.ID)
			if baseID == "" {
				baseID = uuid.NewString()
			}
			if _, exists := baseIDs[baseID]; exists {
				return Document{}, fmt.Errorf("camera %q has duplicate base location id %q", cameraName, baseID)
			}
			baseIDs[baseID] = struct{}{}

			baseName := strings.TrimSpace(baseLocation.Name)
			if baseName == "" {
				baseName = fmt.Sprintf("Base %d", baseIndex+1)
			}

			roiIDs := make(map[string]struct{}, len(baseLocation.ROIs))
			normalizedBase := BaseLocation{
				Active: baseLocation.Active,
				ID:     baseID,
				Name:   baseName,
				PTZ: PTZPosition{
					Pan:  clamp(baseLocation.PTZ.Pan, -1, 1),
					Tilt: clamp(baseLocation.PTZ.Tilt, -1, 1),
					Zoom: clamp(baseLocation.PTZ.Zoom, 0, 1),
				},
				ROIs: make([]ROIBoxSpec, 0, len(baseLocation.ROIs)),
			}

			for roiIndex, roi := range baseLocation.ROIs {
				roiID := normalizeIdentifier(roi.ID)
				if roiID == "" {
					roiID = uuid.NewString()
				}
				if _, exists := roiIDs[roiID]; exists {
					return Document{}, fmt.Errorf(
						"camera %q base %q has duplicate ROI id %q",
						cameraName,
						baseName,
						roiID,
					)
				}
				roiIDs[roiID] = struct{}{}

				roiName := strings.TrimSpace(roi.Name)
				if roiName == "" {
					roiName = fmt.Sprintf("ROI %d", roiIndex+1)
				}
				bounds, err := normalizeBounds(roi.Bounds)
				if err != nil {
					return Document{}, fmt.Errorf("camera %q base %q ROI %q: %w", cameraName, baseName, roiName, err)
				}

				normalizedBase.ROIs = append(normalizedBase.ROIs, ROIBoxSpec{
					Active: roi.Active,
					Bounds: bounds,
					Color:  strings.TrimSpace(roi.Color),
					ID:     roiID,
					Name:   roiName,
					Tags:   normalizeTags(roi.Tags),
				})
			}

			normalizedCamera.BaseLocations = append(normalizedCamera.BaseLocations, normalizedBase)
		}

		normalized.Cameras = append(normalized.Cameras, normalizedCamera)
	}

	normalized.UpdatedAt = strings.TrimSpace(document.UpdatedAt)
	if strings.TrimSpace(updatedAt) != "" {
		normalized.UpdatedAt = strings.TrimSpace(updatedAt)
	}
	return normalized, nil
}

func documentStatus(filePath string, document Document) StatusPayload {
	cameraCount := len(document.Cameras)
	baseCount := 0
	roiCount := 0
	for _, camera := range document.Cameras {
		baseCount += len(camera.BaseLocations)
		for _, baseLocation := range camera.BaseLocations {
			roiCount += len(baseLocation.ROIs)
		}
	}

	payloadBytes, _ := json.Marshal(document)
	sum := sha256.Sum256(payloadBytes)
	return StatusPayload{
		BaseLocationCount: baseCount,
		CameraCount:       cameraCount,
		DocumentHash:      hex.EncodeToString(sum[:]),
		FilePath:          filePath,
		ROIBoxCount:       roiCount,
		UpdatedAt:         strings.TrimSpace(document.UpdatedAt),
	}
}

func normalizeBounds(bounds ROIBox) (ROIBox, error) {
	x := clamp(sanitizeFloat(bounds.X), 0, 1)
	y := clamp(sanitizeFloat(bounds.Y), 0, 1)
	width := clamp(sanitizeFloat(bounds.Width), 0, 1)
	height := clamp(sanitizeFloat(bounds.Height), 0, 1)
	if width <= 0 || height <= 0 {
		return ROIBox{}, fmt.Errorf("bounds width and height must both be greater than 0")
	}
	if x+width > 1 {
		width = 1 - x
	}
	if y+height > 1 {
		height = 1 - y
	}
	if width <= 0 || height <= 0 {
		return ROIBox{}, fmt.Errorf("bounds must intersect the visible frame")
	}
	return ROIBox{
		Height: round4(height),
		Width:  round4(width),
		X:      round4(x),
		Y:      round4(y),
	}, nil
}

func normalizeIdentifier(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	return strings.ToLower(trimmed)
}

func normalizeTags(values []string) []string {
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		tag := strings.TrimSpace(value)
		if tag == "" {
			continue
		}
		duplicate := false
		for _, existing := range normalized {
			if strings.EqualFold(existing, tag) {
				duplicate = true
				break
			}
		}
		if !duplicate {
			normalized = append(normalized, tag)
		}
	}
	return normalized
}

func sanitizeFloat(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	return value
}

func clamp(value float64, min float64, max float64) float64 {
	return math.Min(math.Max(value, min), max)
}

func round4(value float64) float64 {
	return math.Round(value*10000) / 10000
}
