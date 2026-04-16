package workflowengine

import (
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"
)

func executionPayload(inputs NodeInputs) map[string]any {
	if context, ok := inputs["__context__"].(*WorkflowExecutionContext); ok && context != nil {
		return cloneMap(context.Payload)
	}
	return map[string]any{}
}

func payloadLookupString(payload map[string]any, keys ...string) string {
	return firstString(payload, keys...)
}

func payloadLookupInt(payload map[string]any, keys ...string) int {
	return firstInt(payload, keys...)
}

func stringValue(value any, fallback string) string {
	switch typed := value.(type) {
	case string:
		if strings.TrimSpace(typed) != "" {
			return strings.TrimSpace(typed)
		}
	case []byte:
		if strings.TrimSpace(string(typed)) != "" {
			return strings.TrimSpace(string(typed))
		}
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case float64:
		if typed == math.Trunc(typed) {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	}
	return fallback
}

func boolValue(value any, fallback bool) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		lowered := strings.ToLower(strings.TrimSpace(typed))
		switch lowered {
		case "1", "true", "yes", "on":
			return true
		case "0", "false", "no", "off":
			return false
		}
	}
	return fallback
}

func intValue(value any, fallback int) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case string:
		if parsed, err := strconv.Atoi(strings.TrimSpace(typed)); err == nil {
			return parsed
		}
	}
	return fallback
}

func floatValue(value any, fallback float64) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case string:
		if parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64); err == nil {
			return parsed
		}
	}
	return fallback
}

func stringSlice(value any) []string {
	switch typed := value.(type) {
	case []string:
		return append([]string(nil), typed...)
	case []any:
		output := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := stringValue(item, ""); text != "" {
				output = append(output, text)
			}
		}
		return output
	default:
		return nil
	}
}

func stringSliceAny(value any) []any {
	values := stringSlice(value)
	output := make([]any, 0, len(values))
	for _, item := range values {
		output = append(output, item)
	}
	return output
}

func stringSliceLower(value any) []string {
	values := stringSlice(value)
	output := make([]string, 0, len(values))
	for _, item := range values {
		output = append(output, strings.ToLower(item))
	}
	return output
}

func floatSliceAny(values []float64) []any {
	output := make([]any, 0, len(values))
	for _, value := range values {
		output = append(output, value)
	}
	return output
}

func detectionsFromValue(value any) []map[string]any {
	switch typed := value.(type) {
	case []map[string]any:
		output := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			output = append(output, detectionMap(item))
		}
		return output
	case []any:
		output := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			output = append(output, detectionMap(item))
		}
		return output
	default:
		return nil
	}
}

func detectionsToAny(values []map[string]any) []any {
	output := make([]any, 0, len(values))
	for _, value := range values {
		output = append(output, value)
	}
	return output
}

func detectionMap(value any) map[string]any {
	raw, ok := value.(map[string]any)
	if !ok {
		return map[string]any{}
	}
	detection := cloneMap(raw)
	if _, ok := detection["xyxy"]; !ok {
		if rawBBoxes, ok := detection["raw_bboxes"]; ok {
			detection["xyxy"] = rawBBoxes
		}
	}
	if _, ok := detection["raw_bboxes"]; !ok {
		if xyxy, ok := detection["xyxy"]; ok {
			detection["raw_bboxes"] = xyxy
		}
	}
	return detection
}

func detectionLabel(detection map[string]any) string {
	return stringValue(detection["label"], stringValue(detection["class_name"], ""))
}

func detectionConfidence(detection map[string]any) float64 {
	return floatValue(detection["conf"], floatValue(detection["confidence"], 0))
}

func detectionBox(detection map[string]any) []float64 {
	if xyxy, ok := detection["xyxy"]; ok {
		if values := coerceFloatSlice(xyxy); len(values) > 0 {
			return values
		}
	}
	return coerceFloatSlice(detection["raw_bboxes"])
}

func violationsFromValue(value any) []map[string]any {
	switch typed := value.(type) {
	case []map[string]any:
		output := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			output = append(output, cloneMap(item))
		}
		return output
	case []any:
		output := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			if raw, ok := item.(map[string]any); ok {
				output = append(output, cloneMap(raw))
			}
		}
		return output
	default:
		return nil
	}
}

func violationsToAny(values []map[string]any) []any {
	output := make([]any, 0, len(values))
	for _, value := range values {
		output = append(output, value)
	}
	return output
}

func highestSeverity(violations []map[string]any) string {
	order := map[string]int{"info": 0, "warning": 1, "critical": 2}
	best := "info"
	for _, violation := range violations {
		severity := stringValue(violation["severity"], "warning")
		if order[severity] > order[best] {
			best = severity
		}
	}
	if len(violations) == 0 {
		return "info"
	}
	return best
}

func firstViolationLabel(violations []map[string]any) string {
	labels := make([]string, 0, len(violations))
	for _, violation := range violations {
		label := stringValue(violation["label"], stringValue(violation["check_type"], "violation"))
		if label != "" {
			labels = append(labels, label)
		}
	}
	slices.Sort(labels)
	if len(labels) == 0 {
		return "violation"
	}
	return labels[0]
}

func resolveViolationText(message string, violations []map[string]any, cameraName string) string {
	if strings.TrimSpace(message) != "" {
		return strings.TrimSpace(message)
	}
	parts := make([]string, 0)
	for _, violation := range violations {
		if text := stringValue(violation["message"], ""); text != "" {
			parts = append(parts, text)
		}
	}
	if len(parts) > 0 {
		return strings.Join(parts, "; ")
	}
	label := firstViolationLabel(violations)
	if cameraName != "" {
		return fmt.Sprintf("%s violation occurred in %s", strings.ReplaceAll(strings.Title(strings.ReplaceAll(label, "_", " ")), "-", " "), cameraName)
	}
	return fmt.Sprintf("%s violation occurred", strings.ReplaceAll(strings.Title(strings.ReplaceAll(label, "_", " ")), "-", " "))
}

func buildAlertMessage(prefix string, label string, cameraName string, violations []map[string]any) string {
	message := resolveViolationText("", violations, cameraName)
	if strings.TrimSpace(label) != "" {
		if cameraName != "" {
			message = fmt.Sprintf("%s violation occurred in %s", strings.ReplaceAll(strings.Title(strings.ReplaceAll(label, "_", " ")), "-", " "), cameraName)
		} else {
			message = fmt.Sprintf("%s violation occurred", strings.ReplaceAll(strings.Title(strings.ReplaceAll(label, "_", " ")), "-", " "))
		}
	}
	if strings.TrimSpace(prefix) != "" {
		return strings.TrimSpace(prefix) + " " + message
	}
	return message
}

func keywordLabels(keywords []string) []string {
	labels := make(map[string]struct{})
	for _, keyword := range keywords {
		for _, label := range keywordToDetections[keyword] {
			labels[label] = struct{}{}
		}
	}
	output := make([]string, 0, len(labels))
	for label := range labels {
		output = append(output, label)
	}
	slices.Sort(output)
	return output
}

func roiDefinitionsFromPayload(payload map[string]any) []map[string]any {
	if value, ok := payload["roi_config"]; ok {
		return roiDefinitionsFromValue(value)
	}
	metadata := firstMap(payload, "metadata")
	if value, ok := metadata["roi_config"]; ok {
		return roiDefinitionsFromValue(value)
	}
	if value, ok := metadata["rois"]; ok {
		return roiDefinitionsFromValue(value)
	}
	return nil
}

func roiDefinitionsFromValue(value any) []map[string]any {
	switch typed := value.(type) {
	case []map[string]any:
		output := make([]map[string]any, 0, len(typed))
		for _, roi := range typed {
			output = append(output, roiDefinition(roi))
		}
		return output
	case []any:
		output := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			if raw, ok := item.(map[string]any); ok {
				output = append(output, roiDefinition(raw))
			}
		}
		return output
	case map[string]any:
		output := make([]map[string]any, 0, len(typed))
		for name, raw := range typed {
			if roiDetails, ok := raw.(map[string]any); ok {
				normalized := roiDefinition(roiDetails)
				if stringValue(normalized["name"], "") == "" {
					normalized["name"] = name
				}
				output = append(output, normalized)
			}
		}
		return output
	default:
		return nil
	}
}

func roiDefinitionsToAny(values []map[string]any) []any {
	output := make([]any, 0, len(values))
	for _, value := range values {
		output = append(output, value)
	}
	return output
}

func roiDefinition(value any) map[string]any {
	raw, ok := value.(map[string]any)
	if !ok {
		return map[string]any{}
	}
	roi := cloneMap(raw)
	if stringValue(roi["name"], "") == "" {
		roi["name"] = stringValue(roi["selector"], "")
	}
	if _, ok := roi["monitor_keywords"]; !ok {
		roi["monitor_keywords"] = []any{}
	}
	if _, ok := roi["points"]; !ok {
		roi["points"] = []any{}
	}
	if _, ok := roi["enable_speaker"]; !ok {
		roi["enable_speaker"] = true
	}
	if _, ok := roi["enable_alert"]; !ok {
		roi["enable_alert"] = true
	}
	if _, ok := roi["enable_video_alerts"]; !ok {
		roi["enable_video_alerts"] = true
	}
	if _, ok := roi["save_violation_image"]; !ok {
		roi["save_violation_image"] = true
	}
	if _, ok := roi["alert_time_pause"]; !ok {
		roi["alert_time_pause"] = 5
	}
	return roi
}

func roiMatchesReference(roi map[string]any, reference string) bool {
	reference = strings.ToLower(strings.TrimSpace(reference))
	if reference == "" {
		return false
	}
	selector := strings.ToLower(strings.TrimSpace(stringValue(roi["selector"], "")))
	if selector != "" && selector == reference {
		return true
	}
	name := strings.ToLower(strings.TrimSpace(stringValue(roi["name"], "")))
	return name == reference
}

func parseROIPoints(value any) [][2]float64 {
	rawPoints, ok := value.([]any)
	if !ok {
		switch typed := value.(type) {
		case []string:
			rawPoints = make([]any, 0, len(typed))
			for _, point := range typed {
				rawPoints = append(rawPoints, point)
			}
		default:
			return nil
		}
	}
	points := make([][2]float64, 0, len(rawPoints))
	for _, rawPoint := range rawPoints {
		switch typed := rawPoint.(type) {
		case string:
			parts := strings.Split(typed, ",")
			if len(parts) < 2 {
				continue
			}
			points = append(points, [2]float64{
				floatValue(parts[0], 0),
				floatValue(parts[1], 0),
			})
		case []any:
			if len(typed) < 2 {
				continue
			}
			points = append(points, [2]float64{
				floatValue(typed[0], 0),
				floatValue(typed[1], 0),
			})
		}
	}
	return points
}

func pointInPolygon(px float64, py float64, polygon [][2]float64) bool {
	if len(polygon) < 3 {
		return false
	}
	inside := false
	j := len(polygon) - 1
	for i := range polygon {
		xi, yi := polygon[i][0], polygon[i][1]
		xj, yj := polygon[j][0], polygon[j][1]
		if (yi > py) != (yj > py) {
			slope := (xj-xi)*(py-yi)/(yj-yi) + xi
			if px < slope {
				inside = !inside
			}
		}
		j = i
	}
	return inside
}

func bboxIntersectsPolygon(x1 float64, y1 float64, x2 float64, y2 float64, polygon [][2]float64) bool {
	if len(polygon) < 3 {
		return false
	}
	corners := [][2]float64{{x1, y1}, {x2, y1}, {x2, y2}, {x1, y2}}
	for _, corner := range corners {
		if pointInPolygon(corner[0], corner[1], polygon) {
			return true
		}
	}
	center := [2]float64{(x1 + x2) / 2, (y1 + y2) / 2}
	if pointInPolygon(center[0], center[1], polygon) {
		return true
	}
	for _, point := range polygon {
		if point[0] >= x1 && point[0] <= x2 && point[1] >= y1 && point[1] <= y2 {
			return true
		}
	}
	return false
}

func filterDetectionsByClasses(detections []map[string]any, classes []string) []map[string]any {
	lookup := make(map[string]struct{}, len(classes))
	for _, className := range classes {
		lookup[strings.ToLower(className)] = struct{}{}
	}
	filtered := make([]map[string]any, 0)
	for _, detection := range detections {
		if _, ok := lookup[strings.ToLower(detectionLabel(detection))]; ok {
			filtered = append(filtered, detection)
		}
	}
	return filtered
}

func centerOfDetection(detection map[string]any) []float64 {
	box := detectionBox(detection)
	if len(box) < 4 {
		return []float64{0, 0}
	}
	return []float64{(box[0] + box[2]) / 2, (box[1] + box[3]) / 2}
}

func proximityScore(left map[string]any, right map[string]any, mode string) float64 {
	leftBox := detectionBox(left)
	rightBox := detectionBox(right)
	if len(leftBox) < 4 || len(rightBox) < 4 {
		return 0
	}
	if mode == "iou" {
		ix1 := maxFloat(leftBox[0], rightBox[0])
		iy1 := maxFloat(leftBox[1], rightBox[1])
		ix2 := minFloat(leftBox[2], rightBox[2])
		iy2 := minFloat(leftBox[3], rightBox[3])
		inter := maxFloat(0, ix2-ix1) * maxFloat(0, iy2-iy1)
		leftArea := math.Abs((leftBox[2] - leftBox[0]) * (leftBox[3] - leftBox[1]))
		rightArea := math.Abs((rightBox[2] - rightBox[0]) * (rightBox[3] - rightBox[1]))
		union := leftArea + rightArea - inter
		if union <= 0 {
			return 0
		}
		return inter / union
	}
	leftCenter := centerOfDetection(left)
	rightCenter := centerOfDetection(right)
	return math.Hypot(leftCenter[0]-rightCenter[0], leftCenter[1]-rightCenter[1])
}

func compareFloat(actual float64, operator string, threshold float64) bool {
	switch operator {
	case ">":
		return actual > threshold
	case "<":
		return actual < threshold
	case ">=":
		return actual >= threshold
	case "<=":
		return actual <= threshold
	case "==":
		return actual == threshold
	case "!=":
		return actual != threshold
	default:
		return false
	}
}

func buildCloudForwardBody(payload map[string]any, cameraID string, cameraName string, frameID string, message string, mediaKind string, violations []map[string]any) map[string]any {
	return map[string]any{
		"cameraId":   cameraID,
		"cameraName": cameraName,
		"frameId":    frameID,
		"imageId":    frameID,
		"media": map[string]any{
			"kind":              mediaKind,
			"processedFrameKey": payloadLookupString(payload, "processed_frame_key"),
			"rawFrameKey":       payloadLookupString(payload, "raw_frame_key"),
		},
		"message":    message,
		"violations": violationsToAny(violations),
	}
}

func buildCloudForwardRequest(path string, body map[string]any) map[string]any {
	return map[string]any{
		"body":   body,
		"method": "POST",
		"path":   path,
	}
}

func sliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func minFloat(left float64, right float64) float64 {
	if left < right {
		return left
	}
	return right
}

func maxFloat(left float64, right float64) float64 {
	if left > right {
		return left
	}
	return right
}

func timeNowString() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

func timeNowUnixNano() int64 {
	return time.Now().UTC().UnixNano()
}
