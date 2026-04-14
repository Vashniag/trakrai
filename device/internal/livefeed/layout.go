package livefeed

import (
	"fmt"
	"slices"
	"strings"
)

type LiveLayoutMode string

const (
	LiveLayoutSingle LiveLayoutMode = "single"
	LiveLayoutGrid4  LiveLayoutMode = "grid-4"
	LiveLayoutGrid9  LiveLayoutMode = "grid-9"
	LiveLayoutFocus8 LiveLayoutMode = "focus-8"
	LiveLayoutGrid16 LiveLayoutMode = "grid-16"
)

type LiveLayoutPlan struct {
	CameraNames []string
	Mode        LiveLayoutMode
}

func NormalizeLiveLayoutPlan(mode string, cameraName string, cameraNames []string) (LiveLayoutPlan, error) {
	normalizedMode := normalizeLiveLayoutMode(mode)
	normalizedCameraNames := make([]string, 0, len(cameraNames)+1)
	seenCameraNames := make(map[string]struct{}, len(cameraNames)+1)

	appendCameraName := func(candidate string) {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			return
		}
		if _, ok := seenCameraNames[candidate]; ok {
			return
		}

		seenCameraNames[candidate] = struct{}{}
		normalizedCameraNames = append(normalizedCameraNames, candidate)
	}

	appendCameraName(cameraName)
	for _, candidate := range cameraNames {
		appendCameraName(candidate)
	}

	if len(normalizedCameraNames) == 0 {
		return LiveLayoutPlan{}, fmt.Errorf("at least one camera is required")
	}

	capacity := normalizedMode.Capacity()
	if capacity <= 0 {
		return LiveLayoutPlan{}, fmt.Errorf("unsupported live layout mode %q", normalizedMode)
	}

	if len(normalizedCameraNames) > capacity {
		normalizedCameraNames = slices.Clone(normalizedCameraNames[:capacity])
	}

	return LiveLayoutPlan{
		CameraNames: normalizedCameraNames,
		Mode:        normalizedMode,
	}, nil
}

func normalizeLiveLayoutMode(mode string) LiveLayoutMode {
	switch LiveLayoutMode(strings.TrimSpace(mode)) {
	case LiveLayoutGrid4:
		return LiveLayoutGrid4
	case LiveLayoutGrid9:
		return LiveLayoutGrid9
	case LiveLayoutFocus8:
		return LiveLayoutFocus8
	case LiveLayoutGrid16:
		return LiveLayoutGrid16
	case LiveLayoutSingle:
		fallthrough
	default:
		return LiveLayoutSingle
	}
}

func (mode LiveLayoutMode) Capacity() int {
	switch mode {
	case LiveLayoutGrid4:
		return 4
	case LiveLayoutGrid9:
		return 9
	case LiveLayoutFocus8:
		return 8
	case LiveLayoutGrid16:
		return 16
	case LiveLayoutSingle:
		fallthrough
	default:
		return 1
	}
}

func (plan LiveLayoutPlan) PrimaryCamera() string {
	if len(plan.CameraNames) == 0 {
		return ""
	}

	return plan.CameraNames[0]
}

func (plan LiveLayoutPlan) Details() map[string]interface{} {
	details := map[string]interface{}{
		"layoutMode":  string(plan.Mode),
		"cameraNames": slices.Clone(plan.CameraNames),
	}

	if primaryCamera := plan.PrimaryCamera(); primaryCamera != "" {
		details["primaryCamera"] = primaryCamera
	}

	return details
}
