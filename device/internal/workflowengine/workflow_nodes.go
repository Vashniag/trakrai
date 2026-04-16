package workflowengine

import (
	"fmt"
	"slices"
	"strings"
)

const (
	cloudCommServiceName  = "cloud-comm"
	audioAlertServiceName = "audio-alert"
	audioAlertPlayCommand = "play-alert"
	eventRecorderService  = "event-recorder"
	videoRecorderService  = "video-recorder"
	defaultExternalRoute  = "/trpc/external/violations.ingest"
)

var keywordToDetections = map[string][]string{
	"Crowd":                 {"person"},
	"Equipment":             {"equipmentforklift", "crane", "excavator"},
	"Fire / Smoke":          {"fire", "smoke"},
	"Fire Evacuation":       {"fire", "smoke", "person"},
	"Forklift Proximity":    {"equipmentforklift", "person"},
	"Gloves":                {"nogloves"},
	"Hard Hat":              {"nohelmet"},
	"Hot Work":              {"welding", "person", "nohelmet", "nogloves", "nosafetyvest", "nosafetyharness", "noshoes"},
	"Intrusion":             {"person"},
	"Loading Zone":          {"truck", "load", "equipmentforklift", "person"},
	"Lone Worker":           {"person"},
	"PPE Compliance":        {"nohelmet", "nogloves", "nosafetyvest", "nosafetyharness", "noshoes"},
	"Person Near Crane":     {"crane", "person"},
	"Person Near Excavator": {"excavator", "person"},
	"Safety Harness":        {"nosafetyharness"},
	"Safety Vest":           {"nosafetyvest"},
	"Shoes":                 {"noshoes"},
	"Smoking":               {"smoking"},
	"Spill / Leak":          {"spill", "leak"},
	"Spill Hazard":          {"spill", "person"},
	"Unauthorized Vehicle":  {"truck", "car", "bus", "van", "excavator", "tractor"},
	"Vehicle":               {"truck", "car", "bus", "excavator", "tractor", "van", "equipmentforklift"},
	"Vehicle Count":         {"truck", "car", "bus", "van", "equipmentforklift"},
}

func registerBuiltinNodes(registry *NodeRegistry) {
	registerDetectionNodes(registry)
	registerROINodes(registry)
	registerSafetyNodes(registry)
	registerAlertNodes(registry)
}

func registerDetectionNodes(registry *NodeRegistry) {
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryTrigger,
		Description: "Entry point that exposes the hydrated detection payload.",
		DisplayName: "Detection Input",
		NodeTypeID:  "detection-input",
		Outputs: []PortDefinition{
			{Name: "detections", DataType: "array"},
			{Name: "classCount", DataType: "object"},
			{Name: "cameraId", DataType: "string"},
			{Name: "cameraName", DataType: "string"},
			{Name: "frameId", DataType: "string"},
			{Name: "imageId", DataType: "string"},
			{Name: "hasDetections", DataType: "boolean"},
		},
	}, detectionInputNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryDataSource,
		Description: "Expose detections without requiring an explicit trigger node.",
		DisplayName: "Get Detections",
		NodeTypeID:  "get-detections",
		Outputs: []PortDefinition{
			{Name: "detections", DataType: "array"},
			{Name: "count", DataType: "number"},
			{Name: "classCount", DataType: "object"},
			{Name: "hasDetections", DataType: "boolean"},
		},
	}, getDetectionsNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryDataSource,
		Description: "Expose camera metadata from the workflow payload.",
		DisplayName: "Get Camera ID",
		NodeTypeID:  "get-camera-id",
		Outputs: []PortDefinition{
			{Name: "cameraId", DataType: "string"},
			{Name: "cameraName", DataType: "string"},
			{Name: "imageId", DataType: "string"},
		},
	}, getCameraIDNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryDataSource,
		Description: "Expose the current PTZ base index from payload metadata.",
		DisplayName: "Get Camera Current Base Index",
		NodeTypeID:  "get-camera-current-base-index",
		Outputs: []PortDefinition{
			{Name: "cameraId", DataType: "string"},
			{Name: "cameraName", DataType: "string"},
			{Name: "locationIndex", DataType: "number"},
			{Name: "locationName", DataType: "string"},
			{Name: "hasLocation", DataType: "boolean"},
		},
	}, getCameraCurrentBaseIndexNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryDataSource,
		Description: "Filter payload detections directly by class names.",
		DisplayName: "Get Detections by Class",
		NodeTypeID:  "get-detections-by-class",
		Inputs: []PortDefinition{
			{Name: "classNames", DataType: "array", PortType: "config"},
		},
		Outputs: []PortDefinition{
			{Name: "detections", DataType: "array"},
			{Name: "count", DataType: "number"},
			{Name: "hasDetections", DataType: "boolean"},
			{Name: "unmatched", DataType: "array"},
		},
	}, getDetectionsByClassNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryFilter,
		Description: "Filter detections by class label.",
		DisplayName: "Filter by Class",
		NodeTypeID:  "filter-by-class",
		Inputs: []PortDefinition{
			{Name: "detections", DataType: "array"},
			{Name: "classNames", DataType: "array", PortType: "config"},
			{Name: "caseSensitive", DataType: "boolean", Default: false, PortType: "config"},
		},
		Outputs: []PortDefinition{
			{Name: "matched", DataType: "array"},
			{Name: "unmatched", DataType: "array"},
			{Name: "matchedCount", DataType: "number"},
		},
	}, filterByClassNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryFilter,
		Description: "Filter detections by confidence.",
		DisplayName: "Filter by Confidence",
		NodeTypeID:  "filter-by-confidence",
		Inputs: []PortDefinition{
			{Name: "detections", DataType: "array"},
			{Name: "threshold", DataType: "number", Default: 0.5, PortType: "config"},
		},
		Outputs: []PortDefinition{
			{Name: "above", DataType: "array"},
			{Name: "below", DataType: "array"},
			{Name: "equal", DataType: "array"},
			{Name: "aboveCount", DataType: "number"},
		},
	}, filterByConfidenceNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryAggregator,
		Description: "Combine two detection arrays.",
		DisplayName: "Combine Detections Array",
		NodeTypeID:  "combine-detections-array",
		Inputs: []PortDefinition{
			{Name: "a", DataType: "array"},
			{Name: "b", DataType: "array"},
		},
		Outputs: []PortDefinition{
			{Name: "detections", DataType: "array"},
			{Name: "count", DataType: "number"},
		},
	}, combineDetectionsArrayNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryTransform,
		Description: "Extract labels, confidences, and boxes.",
		DisplayName: "Extract BBox Data",
		NodeTypeID:  "extract-bbox-data",
		Inputs: []PortDefinition{
			{Name: "detections", DataType: "array"},
		},
		Outputs: []PortDefinition{
			{Name: "labels", DataType: "array"},
			{Name: "confidences", DataType: "array"},
			{Name: "boxes", DataType: "array"},
		},
	}, extractBBoxDataNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryAggregator,
		Description: "Count detections by label.",
		DisplayName: "Count by Class",
		NodeTypeID:  "count-by-class",
		Inputs: []PortDefinition{
			{Name: "detections", DataType: "array"},
		},
		Outputs: []PortDefinition{
			{Name: "counts", DataType: "object"},
			{Name: "total", DataType: "number"},
			{Name: "classes", DataType: "array"},
		},
	}, countByClassNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryCondition,
		Description: "Check whether a class is present.",
		DisplayName: "Check Class Present",
		NodeTypeID:  "check-class-present",
		Inputs: []PortDefinition{
			{Name: "detections", DataType: "array"},
			{Name: "className", DataType: "string", PortType: "config"},
		},
		Outputs: []PortDefinition{
			{Name: "present", DataType: "boolean"},
			{Name: "absent", DataType: "boolean"},
			{Name: "count", DataType: "number"},
		},
	}, checkClassPresentNode)
}

func registerROINodes(registry *NodeRegistry) {
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryTrigger,
		Description: "Expose ROI definitions for the current frame.",
		DisplayName: "ROI Input",
		NodeTypeID:  "roi-input",
		Outputs: []PortDefinition{
			{Name: "rois", DataType: "array"},
			{Name: "roiNames", DataType: "array"},
			{Name: "roiSelectors", DataType: "array"},
			{Name: "roiCount", DataType: "number"},
			{Name: "hasRois", DataType: "boolean"},
			{Name: "cameraId", DataType: "string"},
			{Name: "cameraName", DataType: "string"},
			{Name: "allLabels", DataType: "array"},
		},
	}, roiInputNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryFilter,
		Description: "Find a ROI by selector or name.",
		DisplayName: "Filter ROI by Name",
		NodeTypeID:  "filter-roi-by-name",
		Inputs: []PortDefinition{
			{Name: "rois", DataType: "array"},
			{Name: "name", DataType: "string", PortType: "config"},
		},
		Outputs: []PortDefinition{
			{Name: "roi", DataType: "object"},
			{Name: "found", DataType: "boolean"},
			{Name: "roiName", DataType: "string"},
			{Name: "selector", DataType: "string"},
		},
	}, filterROIByNameNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryDataSource,
		Description: "Resolve one ROI for the active base scope.",
		DisplayName: "Get ROI by Name for Given Base",
		NodeTypeID:  "get-roi-by-name-for-base",
		Inputs: []PortDefinition{
			{Name: "name", DataType: "string", PortType: "config"},
			{Name: "locationIndex", DataType: "number", Default: -1, PortType: "both"},
		},
		Outputs: []PortDefinition{
			{Name: "roi", DataType: "object"},
			{Name: "found", DataType: "boolean"},
			{Name: "roiName", DataType: "string"},
			{Name: "selector", DataType: "string"},
			{Name: "keywords", DataType: "array"},
			{Name: "permitNumber", DataType: "string"},
		},
	}, getROIByNameForBaseNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryTransform,
		Description: "Extract monitor keywords from a ROI.",
		DisplayName: "Get ROI Keywords",
		NodeTypeID:  "get-roi-keywords",
		Inputs: []PortDefinition{
			{Name: "roi", DataType: "object"},
		},
		Outputs: []PortDefinition{
			{Name: "keywords", DataType: "array"},
			{Name: "permitNumber", DataType: "string"},
			{Name: "roiName", DataType: "string"},
			{Name: "hasKeywords", DataType: "boolean"},
		},
	}, getROIKeywordsNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryTransform,
		Description: "Extract alert settings from a ROI definition.",
		DisplayName: "Get ROI Alert Settings",
		NodeTypeID:  "get-roi-alert-settings",
		Inputs: []PortDefinition{
			{Name: "roi", DataType: "object"},
		},
		Outputs: []PortDefinition{
			{Name: "enableSpeaker", DataType: "boolean"},
			{Name: "enableAlert", DataType: "boolean"},
			{Name: "enableVideoAlerts", DataType: "boolean"},
			{Name: "saveViolationImage", DataType: "boolean"},
			{Name: "alertTimePause", DataType: "number"},
		},
	}, getROIAlertSettingsNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryTransform,
		Description: "Convert ROI monitor keywords to detection labels.",
		DisplayName: "Keywords to Labels",
		NodeTypeID:  "keywords-to-labels",
		Inputs: []PortDefinition{
			{Name: "keywords", DataType: "array"},
		},
		Outputs: []PortDefinition{
			{Name: "labels", DataType: "array"},
			{Name: "labelCount", DataType: "number"},
		},
	}, keywordsToLabelsNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryFilter,
		Description: "Split detections by ROI polygon intersection.",
		DisplayName: "Filter Detections by ROI",
		NodeTypeID:  "filter-detections-by-roi",
		Inputs: []PortDefinition{
			{Name: "detections", DataType: "array"},
			{Name: "roi", DataType: "object"},
		},
		Outputs: []PortDefinition{
			{Name: "inside", DataType: "array"},
			{Name: "outside", DataType: "array"},
			{Name: "insideCount", DataType: "number"},
			{Name: "hasDetections", DataType: "boolean"},
			{Name: "roiName", DataType: "string"},
		},
	}, filterDetectionsByROINode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryCondition,
		Description: "Check whether one detection intersects the ROI polygon.",
		DisplayName: "Check Detection in ROI",
		NodeTypeID:  "check-detection-in-roi",
		Inputs: []PortDefinition{
			{Name: "detection", DataType: "object"},
			{Name: "roi", DataType: "object"},
		},
		Outputs: []PortDefinition{
			{Name: "isInside", DataType: "boolean"},
			{Name: "isOutside", DataType: "boolean"},
			{Name: "roiName", DataType: "string"},
		},
	}, checkDetectionInROINode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryAggregator,
		Description: "Count detections inside each ROI.",
		DisplayName: "Count Detections in ROIs",
		NodeTypeID:  "count-detections-in-rois",
		Inputs: []PortDefinition{
			{Name: "detections", DataType: "array"},
			{Name: "rois", DataType: "array"},
		},
		Outputs: []PortDefinition{
			{Name: "countsPerRoi", DataType: "object"},
			{Name: "totalInside", DataType: "number"},
			{Name: "roiWithMost", DataType: "string"},
		},
	}, countDetectionsInROIsNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryFilter,
		Description: "Filter detections whose center lands inside an ROI polygon.",
		DisplayName: "Match to ROI",
		NodeTypeID:  "match-to-roi",
		Inputs: []PortDefinition{
			{Name: "detections", DataType: "array"},
			{Name: "roiPoints", DataType: "array", PortType: "both"},
		},
		Outputs: []PortDefinition{
			{Name: "matched", DataType: "array"},
			{Name: "unmatched", DataType: "array"},
			{Name: "matchedCount", DataType: "number"},
		},
	}, matchToROINode)
}

func registerSafetyNodes(registry *NodeRegistry) {
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryCondition,
		Description: "Compare a detection count against a threshold.",
		DisplayName: "Check Count",
		NodeTypeID:  "check-count",
		Inputs: []PortDefinition{
			{Name: "detections", DataType: "array"},
			{Name: "classes", DataType: "array", PortType: "both"},
			{Name: "operator", DataType: "string", Default: ">", PortType: "both"},
			{Name: "threshold", DataType: "number", Default: 5, PortType: "both"},
			{Name: "checkType", DataType: "string", Default: "count", PortType: "config"},
		},
		Outputs: []PortDefinition{
			{Name: "violated", DataType: "boolean"},
			{Name: "violations", DataType: "array"},
			{Name: "count", DataType: "number"},
			{Name: "detectedCount", DataType: "number"},
		},
	}, checkCountNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryCondition,
		Description: "Find child detections attached to parent detections.",
		DisplayName: "Check Child Detection",
		NodeTypeID:  "check-child-detection",
		Inputs: []PortDefinition{
			{Name: "detections", DataType: "array"},
			{Name: "parentClasses", DataType: "array", PortType: "both"},
			{Name: "childClasses", DataType: "array", PortType: "both"},
			{Name: "checkType", DataType: "string", Default: "child_detection", PortType: "config"},
		},
		Outputs: []PortDefinition{
			{Name: "violated", DataType: "boolean"},
			{Name: "violations", DataType: "array"},
			{Name: "count", DataType: "number"},
		},
	}, checkChildDetectionNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryCondition,
		Description: "Check whether two hazard groups coexist in the scene.",
		DisplayName: "Check Coexistence",
		NodeTypeID:  "check-coexistence",
		Inputs: []PortDefinition{
			{Name: "detections", DataType: "array"},
			{Name: "hazardClasses", DataType: "array", PortType: "both"},
			{Name: "personClasses", DataType: "array", Default: []string{"person"}, PortType: "both"},
			{Name: "checkType", DataType: "string", Default: "coexistence", PortType: "config"},
		},
		Outputs: []PortDefinition{
			{Name: "violated", DataType: "boolean"},
			{Name: "violations", DataType: "array"},
			{Name: "count", DataType: "number"},
		},
	}, checkCoexistenceNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryCondition,
		Description: "Check distance or overlap between two detection groups.",
		DisplayName: "Check Proximity",
		NodeTypeID:  "check-proximity",
		Inputs: []PortDefinition{
			{Name: "detections", DataType: "array"},
			{Name: "classesA", DataType: "array", PortType: "both"},
			{Name: "classesB", DataType: "array", PortType: "both"},
			{Name: "maxDistance", DataType: "number", Default: 0.15, PortType: "both"},
			{Name: "mode", DataType: "string", Default: "distance", PortType: "config"},
			{Name: "checkType", DataType: "string", Default: "proximity", PortType: "config"},
		},
		Outputs: []PortDefinition{
			{Name: "violated", DataType: "boolean"},
			{Name: "violations", DataType: "array"},
			{Name: "count", DataType: "number"},
		},
	}, checkProximityNode)
}

func registerAlertNodes(registry *NodeRegistry) {
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryAggregator,
		Description: "Merge one or more violation lists.",
		DisplayName: "Aggregate Violations",
		NodeTypeID:  "aggregate-violations",
		Inputs: []PortDefinition{
			{Name: "lists", DataType: "array"},
		},
		Outputs: []PortDefinition{
			{Name: "violations", DataType: "array"},
			{Name: "totalCount", DataType: "number"},
			{Name: "hasViolations", DataType: "boolean"},
			{Name: "severity", DataType: "string"},
		},
	}, aggregateViolationsNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryTransform,
		Description: "Build a human-readable alert message.",
		DisplayName: "Prepare Alert Message",
		NodeTypeID:  "prepare-alert-message",
		Inputs: []PortDefinition{
			{Name: "violations", DataType: "array"},
			{Name: "cameraName", DataType: "string", Default: "", PortType: "both"},
			{Name: "label", DataType: "string", Default: "", PortType: "both"},
			{Name: "prefix", DataType: "string", Default: "", PortType: "config"},
		},
		Outputs: []PortDefinition{
			{Name: "message", DataType: "string"},
			{Name: "label", DataType: "string"},
			{Name: "severity", DataType: "string"},
			{Name: "hasMessage", DataType: "boolean"},
		},
	}, prepareAlertMessageNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryAction,
		Description: "Build a structured alert without running side effects.",
		DisplayName: "Generate Alert",
		NodeTypeID:  "generate-alert",
		Inputs: []PortDefinition{
			{Name: "violations", DataType: "array"},
			{Name: "cameraId", DataType: "string", Default: "", PortType: "both"},
			{Name: "cameraName", DataType: "string", Default: "", PortType: "both"},
			{Name: "message", DataType: "string", Default: "", PortType: "config"},
		},
		Outputs: []PortDefinition{
			{Name: "alert", DataType: "object"},
			{Name: "hasAlert", DataType: "boolean"},
			{Name: "severity", DataType: "string"},
			{Name: "violationText", DataType: "string"},
			{Name: "actions", DataType: "array"},
		},
	}, generateAlertNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryAction,
		Description: "Build a TTS-ready text string.",
		DisplayName: "Generate Audio Text",
		NodeTypeID:  "generate-audio-text",
		Inputs: []PortDefinition{
			{Name: "violations", DataType: "array"},
			{Name: "cameraName", DataType: "string", Default: "", PortType: "both"},
			{Name: "cameraId", DataType: "string", Default: "", PortType: "both"},
			{Name: "prefix", DataType: "string", Default: "Attention!", PortType: "config"},
			{Name: "recommendations", DataType: "object", Default: map[string]any{}, PortType: "config"},
		},
		Outputs: []PortDefinition{
			{Name: "text", DataType: "string"},
			{Name: "hasText", DataType: "boolean"},
			{Name: "actions", DataType: "array"},
		},
	}, generateAudioTextNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryAction,
		Description: "Create a speaker playback request for the audio-alert service.",
		DisplayName: "Enqueue Speaker Audio Task",
		NodeTypeID:  "enqueue-speaker-audio-task",
		Inputs: []PortDefinition{
			{Name: "message", DataType: "string", PortType: "both"},
			{Name: "violations", DataType: "array"},
			{Name: "cameraId", DataType: "string", Default: "", PortType: "both"},
			{Name: "cameraName", DataType: "string", Default: "", PortType: "both"},
			{Name: "speakerAddress", DataType: "string", Default: "", PortType: "both"},
			{Name: "alertTimePause", DataType: "number", Default: 5, PortType: "config"},
		},
		Outputs: []PortDefinition{
			{Name: "queued", DataType: "boolean"},
			{Name: "task", DataType: "object"},
			{Name: "action", DataType: "object"},
			{Name: "actions", DataType: "array"},
		},
	}, enqueueSpeakerAudioTaskNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryAction,
		Description: "Create a local playback request for the audio-alert service.",
		DisplayName: "Play Local Audio",
		NodeTypeID:  "play-local-audio",
		Inputs: []PortDefinition{
			{Name: "message", DataType: "string", PortType: "both"},
			{Name: "cameraId", DataType: "string", Default: "", PortType: "both"},
			{Name: "cameraName", DataType: "string", Default: "", PortType: "both"},
			{Name: "language", DataType: "string", Default: "en", PortType: "config"},
			{Name: "alertTimePause", DataType: "number", Default: 5, PortType: "config"},
		},
		Outputs: []PortDefinition{
			{Name: "played", DataType: "boolean"},
			{Name: "action", DataType: "object"},
			{Name: "actions", DataType: "array"},
		},
	}, playLocalAudioNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryAction,
		Description: "Create a cloud-forwarding request for a violation image event.",
		DisplayName: "Send Violation Image to Cloud",
		NodeTypeID:  "send-violation-image-to-cloud",
		Inputs: []PortDefinition{
			{Name: "violations", DataType: "array"},
			{Name: "cameraId", DataType: "string", Default: "", PortType: "both"},
			{Name: "cameraName", DataType: "string", Default: "", PortType: "both"},
			{Name: "imageId", DataType: "string", Default: "", PortType: "both"},
			{Name: "message", DataType: "string", Default: "", PortType: "both"},
			{Name: "path", DataType: "string", Default: defaultExternalRoute, PortType: "config"},
		},
		Outputs: []PortDefinition{
			{Name: "sent", DataType: "boolean"},
			{Name: "payload", DataType: "object"},
			{Name: "action", DataType: "object"},
			{Name: "actions", DataType: "array"},
		},
	}, sendViolationImageToCloudNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryAction,
		Description: "Create a request for the video recorder to render and upload a violation clip.",
		DisplayName: "Send Violation Video to Cloud",
		NodeTypeID:  "send-violation-video-to-cloud",
		Inputs: []PortDefinition{
			{Name: "cameraId", DataType: "string", Default: "", PortType: "both"},
			{Name: "cameraName", DataType: "string", Default: "", PortType: "both"},
			{Name: "imageId", DataType: "string", Default: "", PortType: "both"},
			{Name: "message", DataType: "string", Default: "", PortType: "both"},
			{Name: "preEventSec", DataType: "number", Default: 5, PortType: "config"},
			{Name: "postEventSec", DataType: "number", Default: 5, PortType: "config"},
			{Name: "fps", DataType: "number", Default: 5, PortType: "config"},
			{Name: "path", DataType: "string", Default: defaultExternalRoute, PortType: "config"},
		},
		Outputs: []PortDefinition{
			{Name: "started", DataType: "boolean"},
			{Name: "action", DataType: "object"},
			{Name: "actions", DataType: "array"},
		},
	}, sendViolationVideoToCloudNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryAction,
		Description: "Create a local save request for violation snapshots.",
		DisplayName: "Save Violation Image Locally",
		NodeTypeID:  "save-violation-image-locally",
		Inputs: []PortDefinition{
			{Name: "cameraId", DataType: "string", Default: "", PortType: "both"},
			{Name: "cameraName", DataType: "string", Default: "", PortType: "both"},
			{Name: "imageId", DataType: "string", Default: "", PortType: "both"},
			{Name: "message", DataType: "string", Default: "", PortType: "both"},
		},
		Outputs: []PortDefinition{
			{Name: "saved", DataType: "boolean"},
			{Name: "action", DataType: "object"},
			{Name: "actions", DataType: "array"},
		},
	}, saveViolationImageLocallyNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryAction,
		Description: "Compatibility wrapper for image upload workflows.",
		DisplayName: "Upload Image to Cloud",
		NodeTypeID:  "upload-image-to-cloud",
		Inputs: []PortDefinition{
			{Name: "violations", DataType: "array"},
			{Name: "cameraId", DataType: "string", Default: "", PortType: "both"},
			{Name: "cameraName", DataType: "string", Default: "", PortType: "both"},
			{Name: "imageId", DataType: "string", Default: "", PortType: "both"},
			{Name: "path", DataType: "string", Default: defaultExternalRoute, PortType: "config"},
		},
		Outputs: []PortDefinition{
			{Name: "uploaded", DataType: "boolean"},
			{Name: "imageKey", DataType: "string"},
			{Name: "action", DataType: "object"},
			{Name: "actions", DataType: "array"},
		},
	}, uploadImageToCloudNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryAction,
		Description: "Compatibility wrapper for video upload workflows.",
		DisplayName: "Upload Video to Cloud",
		NodeTypeID:  "upload-video-to-cloud",
		Inputs: []PortDefinition{
			{Name: "cameraId", DataType: "string", Default: "", PortType: "both"},
			{Name: "cameraName", DataType: "string", Default: "", PortType: "both"},
			{Name: "imageId", DataType: "string", Default: "", PortType: "both"},
			{Name: "preEventSec", DataType: "number", Default: 5, PortType: "config"},
			{Name: "postEventSec", DataType: "number", Default: 5, PortType: "config"},
			{Name: "fps", DataType: "number", Default: 5, PortType: "config"},
			{Name: "path", DataType: "string", Default: defaultExternalRoute, PortType: "config"},
		},
		Outputs: []PortDefinition{
			{Name: "uploaded", DataType: "boolean"},
			{Name: "videoKey", DataType: "string"},
			{Name: "action", DataType: "object"},
			{Name: "actions", DataType: "array"},
		},
	}, uploadVideoToCloudNode)
	registry.MustRegister(NodeDefinition{
		Category:    NodeCategoryAction,
		Description: "Create image and video workflow actions for a violation event.",
		DisplayName: "Upload Violation to Cloud",
		NodeTypeID:  "upload-violation-to-cloud",
		Inputs: []PortDefinition{
			{Name: "violations", DataType: "array"},
			{Name: "cameraId", DataType: "string", Default: "", PortType: "both"},
			{Name: "cameraName", DataType: "string", Default: "", PortType: "both"},
			{Name: "preEventSec", DataType: "number", Default: 5, PortType: "config"},
			{Name: "postEventSec", DataType: "number", Default: 5, PortType: "config"},
			{Name: "fps", DataType: "number", Default: 5, PortType: "config"},
			{Name: "enableVideo", DataType: "boolean", Default: true, PortType: "config"},
			{Name: "path", DataType: "string", Default: defaultExternalRoute, PortType: "config"},
		},
		Outputs: []PortDefinition{
			{Name: "uploaded", DataType: "boolean"},
			{Name: "imageKey", DataType: "string"},
			{Name: "videoKey", DataType: "string"},
			{Name: "actions", DataType: "array"},
		},
	}, uploadViolationToCloudNode)
}

func detectionInputNode(inputs NodeInputs) (NodeOutputs, error) {
	payload := executionPayload(inputs)
	detections := detectionsFromValue(payload["bbox"])
	return NodeOutputs{
		"cameraId":      payloadLookupString(payload, "cam_id", "cameraId", "camera_id"),
		"cameraName":    payloadLookupString(payload, "cam_name", "cameraName", "camera_name"),
		"classCount":    coerceCountMap(payload["DetectionPerClass"]),
		"detections":    detectionsToAny(detections),
		"frameId":       payloadLookupString(payload, "frame_id"),
		"hasDetections": len(detections) > 0,
		"imageId":       payloadLookupString(payload, "imgID", "imageId", "image_id", "frame_id"),
	}, nil
}

func getDetectionsNode(inputs NodeInputs) (NodeOutputs, error) {
	data, err := detectionInputNode(inputs)
	if err != nil {
		return nil, err
	}
	detections := detectionsFromValue(data["detections"])
	data["count"] = len(detections)
	return data, nil
}

func getCameraIDNode(inputs NodeInputs) (NodeOutputs, error) {
	payload := executionPayload(inputs)
	return NodeOutputs{
		"cameraId":   payloadLookupString(payload, "cam_id", "cameraId", "camera_id"),
		"cameraName": payloadLookupString(payload, "cam_name", "cameraName", "camera_name"),
		"imageId":    payloadLookupString(payload, "imgID", "imageId", "image_id", "frame_id"),
	}, nil
}

func getCameraCurrentBaseIndexNode(inputs NodeInputs) (NodeOutputs, error) {
	payload := executionPayload(inputs)
	index := payloadLookupInt(payload, "ptz_base_index", "currentBaseIndex", "locationIndex")
	return NodeOutputs{
		"cameraId":      payloadLookupString(payload, "cam_id", "cameraId", "camera_id"),
		"cameraName":    payloadLookupString(payload, "cam_name", "cameraName", "camera_name"),
		"hasLocation":   index >= 0,
		"locationIndex": index,
		"locationName":  payloadLookupString(payload, "ptz_base_name", "locationName"),
	}, nil
}

func getDetectionsByClassNode(inputs NodeInputs) (NodeOutputs, error) {
	detections := detectionsFromValue(executionPayload(inputs)["bbox"])
	classes := stringSlice(inputs["classNames"])
	lookup := make(map[string]struct{}, len(classes))
	for _, className := range classes {
		lookup[strings.ToLower(className)] = struct{}{}
	}

	matched := make([]map[string]any, 0)
	unmatched := make([]map[string]any, 0)
	for _, detection := range detections {
		if _, ok := lookup[strings.ToLower(detectionLabel(detection))]; ok {
			matched = append(matched, detection)
			continue
		}
		unmatched = append(unmatched, detection)
	}

	return NodeOutputs{
		"count":         len(matched),
		"detections":    detectionsToAny(matched),
		"hasDetections": len(matched) > 0,
		"unmatched":     detectionsToAny(unmatched),
	}, nil
}

func filterByClassNode(inputs NodeInputs) (NodeOutputs, error) {
	detections := detectionsFromValue(inputs["detections"])
	classes := stringSlice(inputs["classNames"])
	caseSensitive := boolValue(inputs["caseSensitive"], false)
	lookup := make(map[string]struct{}, len(classes))
	for _, className := range classes {
		key := className
		if !caseSensitive {
			key = strings.ToLower(className)
		}
		lookup[key] = struct{}{}
	}

	matched := make([]map[string]any, 0)
	unmatched := make([]map[string]any, 0)
	for _, detection := range detections {
		key := detectionLabel(detection)
		if !caseSensitive {
			key = strings.ToLower(key)
		}
		if _, ok := lookup[key]; ok {
			matched = append(matched, detection)
			continue
		}
		unmatched = append(unmatched, detection)
	}
	return NodeOutputs{
		"matched":      detectionsToAny(matched),
		"matchedCount": len(matched),
		"unmatched":    detectionsToAny(unmatched),
	}, nil
}

func filterByConfidenceNode(inputs NodeInputs) (NodeOutputs, error) {
	detections := detectionsFromValue(inputs["detections"])
	threshold := floatValue(inputs["threshold"], 0.5)
	above := make([]map[string]any, 0)
	below := make([]map[string]any, 0)
	equal := make([]map[string]any, 0)
	for _, detection := range detections {
		confidence := detectionConfidence(detection)
		switch {
		case confidence > threshold:
			above = append(above, detection)
		case confidence < threshold:
			below = append(below, detection)
		default:
			equal = append(equal, detection)
		}
	}
	return NodeOutputs{
		"above":      detectionsToAny(above),
		"aboveCount": len(above),
		"below":      detectionsToAny(below),
		"equal":      detectionsToAny(equal),
	}, nil
}

func combineDetectionsArrayNode(inputs NodeInputs) (NodeOutputs, error) {
	left := detectionsFromValue(inputs["a"])
	right := detectionsFromValue(inputs["b"])
	combined := append(append(make([]map[string]any, 0, len(left)+len(right)), left...), right...)
	return NodeOutputs{
		"count":      len(combined),
		"detections": detectionsToAny(combined),
	}, nil
}

func extractBBoxDataNode(inputs NodeInputs) (NodeOutputs, error) {
	detections := detectionsFromValue(inputs["detections"])
	labels := make([]any, 0, len(detections))
	confidences := make([]any, 0, len(detections))
	boxes := make([]any, 0, len(detections))
	for _, detection := range detections {
		labels = append(labels, detectionLabel(detection))
		confidences = append(confidences, detectionConfidence(detection))
		boxes = append(boxes, floatSliceAny(detectionBox(detection)))
	}
	return NodeOutputs{
		"boxes":       boxes,
		"confidences": confidences,
		"labels":      labels,
	}, nil
}

func countByClassNode(inputs NodeInputs) (NodeOutputs, error) {
	detections := detectionsFromValue(inputs["detections"])
	counts := make(map[string]int)
	for _, detection := range detections {
		counts[detectionLabel(detection)]++
	}
	classes := make([]any, 0, len(counts))
	for label := range counts {
		classes = append(classes, label)
	}
	slices.SortFunc(classes, func(left any, right any) int {
		return strings.Compare(fmt.Sprint(left), fmt.Sprint(right))
	})
	return NodeOutputs{
		"classes": classes,
		"counts":  counts,
		"total":   len(detections),
	}, nil
}

func checkClassPresentNode(inputs NodeInputs) (NodeOutputs, error) {
	detections := detectionsFromValue(inputs["detections"])
	className := strings.ToLower(stringValue(inputs["className"], ""))
	count := 0
	for _, detection := range detections {
		if strings.ToLower(detectionLabel(detection)) == className {
			count++
		}
	}
	return NodeOutputs{
		"absent":  count == 0,
		"count":   count,
		"present": count > 0,
	}, nil
}

func roiInputNode(inputs NodeInputs) (NodeOutputs, error) {
	payload := executionPayload(inputs)
	rois := roiDefinitionsFromPayload(payload)
	roiNames := make([]any, 0, len(rois))
	selectors := make([]any, 0, len(rois))
	allKeywords := make([]string, 0)
	for _, roi := range rois {
		roiNames = append(roiNames, stringValue(roi["name"], ""))
		if selector := stringValue(roi["selector"], ""); selector != "" {
			selectors = append(selectors, selector)
		}
		allKeywords = append(allKeywords, stringSlice(roi["monitor_keywords"])...)
	}
	allLabels := make([]any, 0)
	for _, label := range keywordLabels(allKeywords) {
		allLabels = append(allLabels, label)
	}
	return NodeOutputs{
		"allLabels":    allLabels,
		"cameraId":     payloadLookupString(payload, "cam_id", "cameraId", "camera_id"),
		"cameraName":   payloadLookupString(payload, "cam_name", "cameraName", "camera_name"),
		"hasRois":      len(rois) > 0,
		"roiCount":     len(rois),
		"roiNames":     roiNames,
		"roiSelectors": selectors,
		"rois":         roiDefinitionsToAny(rois),
	}, nil
}

func filterROIByNameNode(inputs NodeInputs) (NodeOutputs, error) {
	target := strings.TrimSpace(stringValue(inputs["name"], ""))
	rois := roiDefinitionsFromValue(inputs["rois"])
	for _, roi := range rois {
		if roiMatchesReference(roi, target) {
			return NodeOutputs{
				"found":    true,
				"roi":      roi,
				"roiName":  stringValue(roi["name"], ""),
				"selector": stringValue(roi["selector"], ""),
			}, nil
		}
	}
	return NodeOutputs{
		"found":    false,
		"roi":      map[string]any{},
		"roiName":  "",
		"selector": "",
	}, nil
}

func getROIByNameForBaseNode(inputs NodeInputs) (NodeOutputs, error) {
	payload := executionPayload(inputs)
	target := strings.TrimSpace(stringValue(inputs["name"], ""))
	locationIndex := intValue(inputs["locationIndex"], payloadLookupInt(payload, "ptz_base_index", "locationIndex"))
	rois := roiDefinitionsFromPayload(payload)
	for _, roi := range rois {
		if locationIndex >= 0 && intValue(roi["base_id"], -1) != locationIndex {
			continue
		}
		if !roiMatchesReference(roi, target) {
			continue
		}
		return NodeOutputs{
			"found":        true,
			"keywords":     stringSliceAny(roi["monitor_keywords"]),
			"permitNumber": stringValue(roi["permit_number"], ""),
			"roi":          roi,
			"roiName":      stringValue(roi["name"], ""),
			"selector":     stringValue(roi["selector"], ""),
		}, nil
	}
	return NodeOutputs{
		"found":        false,
		"keywords":     []any{},
		"permitNumber": "",
		"roi":          map[string]any{},
		"roiName":      "",
		"selector":     "",
	}, nil
}

func getROIKeywordsNode(inputs NodeInputs) (NodeOutputs, error) {
	roi := roiDefinition(inputs["roi"])
	keywords := stringSliceAny(roi["monitor_keywords"])
	return NodeOutputs{
		"hasKeywords":  len(keywords) > 0,
		"keywords":     keywords,
		"permitNumber": stringValue(roi["permit_number"], ""),
		"roiName":      stringValue(roi["name"], ""),
	}, nil
}

func getROIAlertSettingsNode(inputs NodeInputs) (NodeOutputs, error) {
	roi := roiDefinition(inputs["roi"])
	return NodeOutputs{
		"alertTimePause":     intValue(roi["alert_time_pause"], 5),
		"enableAlert":        boolValue(roi["enable_alert"], true),
		"enableSpeaker":      boolValue(roi["enable_speaker"], true),
		"enableVideoAlerts":  boolValue(roi["enable_video_alerts"], true),
		"saveViolationImage": boolValue(roi["save_violation_image"], true),
	}, nil
}

func keywordsToLabelsNode(inputs NodeInputs) (NodeOutputs, error) {
	labels := keywordLabels(stringSlice(inputs["keywords"]))
	outputs := make([]any, 0, len(labels))
	for _, label := range labels {
		outputs = append(outputs, label)
	}
	return NodeOutputs{
		"labelCount": len(outputs),
		"labels":     outputs,
	}, nil
}

func filterDetectionsByROINode(inputs NodeInputs) (NodeOutputs, error) {
	detections := detectionsFromValue(inputs["detections"])
	roi := roiDefinition(inputs["roi"])
	polygon := parseROIPoints(roi["points"])
	inside := make([]map[string]any, 0)
	outside := make([]map[string]any, 0)
	for _, detection := range detections {
		box := detectionBox(detection)
		if len(box) < 4 || !bboxIntersectsPolygon(box[0], box[1], box[2], box[3], polygon) {
			outside = append(outside, detection)
			continue
		}
		inside = append(inside, detection)
	}
	return NodeOutputs{
		"hasDetections": len(inside) > 0,
		"inside":        detectionsToAny(inside),
		"insideCount":   len(inside),
		"outside":       detectionsToAny(outside),
		"roiName":       stringValue(roi["name"], ""),
	}, nil
}

func checkDetectionInROINode(inputs NodeInputs) (NodeOutputs, error) {
	detection := detectionMap(inputs["detection"])
	roi := roiDefinition(inputs["roi"])
	polygon := parseROIPoints(roi["points"])
	box := detectionBox(detection)
	isInside := len(box) >= 4 && bboxIntersectsPolygon(box[0], box[1], box[2], box[3], polygon)
	return NodeOutputs{
		"isInside":  isInside,
		"isOutside": !isInside,
		"roiName":   stringValue(roi["name"], ""),
	}, nil
}

func countDetectionsInROIsNode(inputs NodeInputs) (NodeOutputs, error) {
	detections := detectionsFromValue(inputs["detections"])
	rois := roiDefinitionsFromValue(inputs["rois"])
	counts := make(map[string]int, len(rois))
	total := 0
	bestName := ""
	bestCount := -1
	for _, roi := range rois {
		name := stringValue(roi["name"], "")
		polygon := parseROIPoints(roi["points"])
		count := 0
		for _, detection := range detections {
			box := detectionBox(detection)
			if len(box) >= 4 && bboxIntersectsPolygon(box[0], box[1], box[2], box[3], polygon) {
				count++
			}
		}
		counts[name] = count
		total += count
		if count > bestCount {
			bestCount = count
			bestName = name
		}
	}
	return NodeOutputs{
		"countsPerRoi": counts,
		"roiWithMost":  bestName,
		"totalInside":  total,
	}, nil
}

func matchToROINode(inputs NodeInputs) (NodeOutputs, error) {
	detections := detectionsFromValue(inputs["detections"])
	polygon := parseROIPoints(inputs["roiPoints"])
	matched := make([]map[string]any, 0)
	unmatched := make([]map[string]any, 0)
	for _, detection := range detections {
		box := detectionBox(detection)
		if len(box) < 4 {
			unmatched = append(unmatched, detection)
			continue
		}
		centerX := (box[0] + box[2]) / 2
		centerY := (box[1] + box[3]) / 2
		if pointInPolygon(centerX, centerY, polygon) {
			matched = append(matched, detection)
			continue
		}
		unmatched = append(unmatched, detection)
	}
	return NodeOutputs{
		"matched":      detectionsToAny(matched),
		"matchedCount": len(matched),
		"unmatched":    detectionsToAny(unmatched),
	}, nil
}

func checkCountNode(inputs NodeInputs) (NodeOutputs, error) {
	detections := detectionsFromValue(inputs["detections"])
	classes := stringSlice(inputs["classes"])
	operator := stringValue(inputs["operator"], ">")
	threshold := floatValue(inputs["threshold"], 5)
	checkType := stringValue(inputs["checkType"], "count")
	matching := filterDetectionsByClasses(detections, classes)
	actual := len(matching)
	triggered := compareFloat(float64(actual), operator, threshold)
	violations := make([]any, 0)
	if triggered {
		violations = append(violations, map[string]any{
			"check_type": checkType,
			"message":    fmt.Sprintf("Count of %s: %d %s %d", strings.Join(classes, ", "), actual, operator, int(threshold)),
			"severity":   "warning",
		})
	}
	return NodeOutputs{
		"count":         len(violations),
		"detectedCount": actual,
		"violated":      triggered,
		"violations":    violations,
	}, nil
}

func checkChildDetectionNode(inputs NodeInputs) (NodeOutputs, error) {
	detections := detectionsFromValue(inputs["detections"])
	parentClasses := stringSliceLower(inputs["parentClasses"])
	childClasses := stringSliceLower(inputs["childClasses"])
	checkType := stringValue(inputs["checkType"], "child_detection")
	violations := make([]any, 0)
	for _, detection := range detections {
		if !sliceContains(parentClasses, strings.ToLower(detectionLabel(detection))) {
			continue
		}
		children, _ := detection["detections"].([]any)
		for _, childRaw := range children {
			child := detectionMap(childRaw)
			if !sliceContains(childClasses, strings.ToLower(detectionLabel(child))) {
				continue
			}
			violations = append(violations, map[string]any{
				"check_type": checkType,
				"detection": map[string]any{
					"class_name": strings.ToLower(detectionLabel(detection)),
					"center":     floatSliceAny(centerOfDetection(detection)),
				},
				"message":  fmt.Sprintf("%s on %s", strings.ToLower(detectionLabel(child)), strings.ToLower(detectionLabel(detection))),
				"severity": "warning",
			})
		}
	}
	return NodeOutputs{
		"count":      len(violations),
		"violated":   len(violations) > 0,
		"violations": violations,
	}, nil
}

func checkCoexistenceNode(inputs NodeInputs) (NodeOutputs, error) {
	detections := detectionsFromValue(inputs["detections"])
	hazards := filterDetectionsByClasses(detections, stringSlice(inputs["hazardClasses"]))
	persons := filterDetectionsByClasses(detections, stringSlice(inputs["personClasses"]))
	checkType := stringValue(inputs["checkType"], "coexistence")
	violations := make([]any, 0)
	if len(hazards) > 0 && len(persons) > 0 {
		for _, hazard := range hazards {
			violations = append(violations, map[string]any{
				"check_type": checkType,
				"detection": map[string]any{
					"class_name": strings.ToLower(detectionLabel(hazard)),
					"center":     floatSliceAny(centerOfDetection(hazard)),
				},
				"message":  fmt.Sprintf("%s detected with %d person(s) present", strings.ToLower(detectionLabel(hazard)), len(persons)),
				"severity": "critical",
			})
		}
	}
	return NodeOutputs{
		"count":      len(violations),
		"violated":   len(violations) > 0,
		"violations": violations,
	}, nil
}

func checkProximityNode(inputs NodeInputs) (NodeOutputs, error) {
	detections := detectionsFromValue(inputs["detections"])
	groupA := filterDetectionsByClasses(detections, stringSlice(inputs["classesA"]))
	groupB := filterDetectionsByClasses(detections, stringSlice(inputs["classesB"]))
	threshold := floatValue(inputs["maxDistance"], 0.15)
	mode := strings.ToLower(stringValue(inputs["mode"], "distance"))
	checkType := stringValue(inputs["checkType"], "proximity")
	violations := make([]any, 0)
	for _, left := range groupA {
		for _, right := range groupB {
			score := proximityScore(left, right, mode)
			triggered := false
			if mode == "iou" {
				triggered = score > threshold
			} else {
				triggered = score < threshold
			}
			if !triggered {
				continue
			}
			violations = append(violations, map[string]any{
				"check_type": checkType,
				"detection": map[string]any{
					"class_name": strings.ToLower(detectionLabel(left)),
					"center":     floatSliceAny(centerOfDetection(left)),
				},
				"message":  fmt.Sprintf("%s near %s (%s=%.3f)", strings.ToLower(detectionLabel(left)), strings.ToLower(detectionLabel(right)), mode, score),
				"severity": "warning",
			})
		}
	}
	return NodeOutputs{
		"count":      len(violations),
		"violated":   len(violations) > 0,
		"violations": violations,
	}, nil
}

func aggregateViolationsNode(inputs NodeInputs) (NodeOutputs, error) {
	rawLists, _ := inputs["lists"].([]any)
	merged := make([]any, 0)
	for _, item := range rawLists {
		switch typed := item.(type) {
		case []any:
			merged = append(merged, typed...)
		case map[string]any:
			merged = append(merged, typed)
		}
	}
	return NodeOutputs{
		"hasViolations": len(merged) > 0,
		"severity":      highestSeverity(violationsFromValue(merged)),
		"totalCount":    len(merged),
		"violations":    merged,
	}, nil
}

func prepareAlertMessageNode(inputs NodeInputs) (NodeOutputs, error) {
	payload := executionPayload(inputs)
	violations := violationsFromValue(inputs["violations"])
	cameraName := stringValue(inputs["cameraName"], payloadLookupString(payload, "cam_name", "cameraName"))
	label := stringValue(inputs["label"], "")
	prefix := stringValue(inputs["prefix"], "")
	if label == "" && len(violations) > 0 {
		label = firstViolationLabel(violations)
	}
	message := buildAlertMessage(prefix, label, cameraName, violations)
	return NodeOutputs{
		"hasMessage": message != "",
		"label":      label,
		"message":    message,
		"severity":   highestSeverity(violations),
	}, nil
}

func generateAlertNode(inputs NodeInputs) (NodeOutputs, error) {
	payload := executionPayload(inputs)
	violations := violationsFromValue(inputs["violations"])
	cameraID := stringValue(inputs["cameraId"], payloadLookupString(payload, "cam_id", "cameraId"))
	cameraName := stringValue(inputs["cameraName"], payloadLookupString(payload, "cam_name", "cameraName"))
	message := stringValue(inputs["message"], "")
	if len(violations) == 0 {
		return NodeOutputs{
			"actions":       []any{},
			"alert":         map[string]any{},
			"hasAlert":      false,
			"severity":      "info",
			"violationText": "",
		}, nil
	}
	violationText := resolveViolationText(message, violations, cameraName)
	return NodeOutputs{
		"actions": []any{},
		"alert": map[string]any{
			"camera_id":       cameraID,
			"camera_name":     cameraName,
			"severity":        highestSeverity(violations),
			"timestamp":       timeNowString(),
			"violation_count": len(violations),
			"violation_text":  violationText,
			"violations":      violationsToAny(violations),
		},
		"hasAlert":      true,
		"severity":      highestSeverity(violations),
		"violationText": violationText,
	}, nil
}

func generateAudioTextNode(inputs NodeInputs) (NodeOutputs, error) {
	payload := executionPayload(inputs)
	violations := violationsFromValue(inputs["violations"])
	cameraName := stringValue(inputs["cameraName"], payloadLookupString(payload, "cam_name", "cameraName"))
	prefix := stringValue(inputs["prefix"], "Attention!")
	recommendations := firstMap(inputs, "recommendations")
	if len(violations) == 0 {
		return NodeOutputs{
			"actions": []any{},
			"hasText": false,
			"text":    "",
		}, nil
	}
	parts := []string{strings.TrimSpace(prefix)}
	if cameraName != "" {
		parts = append(parts, fmt.Sprintf("In camera %s.", cameraName))
	}
	counts := make(map[string]int)
	for _, violation := range violations {
		key := stringValue(violation["check_type"], stringValue(violation["message"], "issue"))
		counts[key]++
	}
	keys := make([]string, 0, len(counts))
	for key := range counts {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	for _, key := range keys {
		parts = append(parts, fmt.Sprintf("%d %s found.", counts[key], strings.ReplaceAll(strings.ReplaceAll(key, "_", " "), "-", " ")))
		if recommendation := stringValue(recommendations[key], ""); recommendation != "" {
			parts = append(parts, recommendation)
		}
	}
	return NodeOutputs{
		"actions": []any{},
		"hasText": true,
		"text":    strings.TrimSpace(strings.Join(parts, " ")),
	}, nil
}

func enqueueSpeakerAudioTaskNode(inputs NodeInputs) (NodeOutputs, error) {
	payload := executionPayload(inputs)
	violations := violationsFromValue(inputs["violations"])
	cameraID := stringValue(inputs["cameraId"], payloadLookupString(payload, "cam_id", "cameraId"))
	cameraName := stringValue(inputs["cameraName"], payloadLookupString(payload, "cam_name", "cameraName"))
	frameID := payloadLookupString(payload, "frame_id", "imgID", "imageId")
	message := stringValue(inputs["message"], resolveViolationText("", violations, cameraName))
	command := map[string]any{
		"message":    message,
		"priority":   "high",
		"request_id": fmt.Sprintf("wf-audio-%d", timeNowUnixNano()),
		"speaker":    stringValue(inputs["speakerAddress"], ""),
		"metadata": map[string]any{
			"alert_time_pause": intValue(inputs["alertTimePause"], 5),
			"camera_id":        cameraID,
			"camera_name":      cameraName,
			"frame_id":         frameID,
			"mode":             "speaker",
			"violations":       violationsToAny(violations),
		},
	}
	action := WorkflowAction{
		Description:   "speaker alert playback",
		Payload:       command,
		Subtopic:      "command",
		TargetService: audioAlertServiceName,
		Type:          audioAlertPlayCommand,
	}
	return NodeOutputs{
		"action":  action,
		"actions": []any{action},
		"queued":  true,
		"task": map[string]any{
			"cameraId":       cameraID,
			"cameraName":     cameraName,
			"frameId":        frameID,
			"message":        message,
			"speakerAddress": stringValue(inputs["speakerAddress"], ""),
			"violations":     violationsToAny(violations),
		},
	}, nil
}

func playLocalAudioNode(inputs NodeInputs) (NodeOutputs, error) {
	payload := executionPayload(inputs)
	message := stringValue(inputs["message"], "")
	command := map[string]any{
		"message":    message,
		"priority":   "normal",
		"request_id": fmt.Sprintf("wf-local-audio-%d", timeNowUnixNano()),
		"metadata": map[string]any{
			"alert_time_pause": intValue(inputs["alertTimePause"], 5),
			"camera_id":        stringValue(inputs["cameraId"], payloadLookupString(payload, "cam_id", "cameraId")),
			"camera_name":      stringValue(inputs["cameraName"], payloadLookupString(payload, "cam_name", "cameraName")),
			"frame_id":         payloadLookupString(payload, "frame_id", "imgID", "imageId"),
			"language":         stringValue(inputs["language"], "en"),
			"mode":             "local",
		},
	}
	action := WorkflowAction{
		Description:   "local audio playback",
		Payload:       command,
		Subtopic:      "command",
		TargetService: audioAlertServiceName,
		Type:          audioAlertPlayCommand,
	}
	return NodeOutputs{
		"action":  action,
		"actions": []any{action},
		"played":  message != "",
	}, nil
}

func sendViolationImageToCloudNode(inputs NodeInputs) (NodeOutputs, error) {
	payload := executionPayload(inputs)
	violations := violationsFromValue(inputs["violations"])
	cameraID := stringValue(inputs["cameraId"], payloadLookupString(payload, "cam_id", "cameraId"))
	cameraName := stringValue(inputs["cameraName"], payloadLookupString(payload, "cam_name", "cameraName"))
	imageID := stringValue(inputs["imageId"], payloadLookupString(payload, "imgID", "frame_id", "imageId"))
	message := stringValue(inputs["message"], resolveViolationText("", violations, cameraName))
	body := buildCloudForwardBody(payload, cameraID, cameraName, imageID, message, "image", violations)
	action := WorkflowAction{
		Description:   "forward image violation metadata to cloud",
		Payload:       buildCloudForwardRequest(stringValue(inputs["path"], defaultExternalRoute), body),
		Subtopic:      "command",
		TargetService: cloudCommServiceName,
		Type:          "forward-external",
	}
	return NodeOutputs{
		"action":  action,
		"actions": []any{action},
		"payload": body,
		"sent":    true,
	}, nil
}

func sendViolationVideoToCloudNode(inputs NodeInputs) (NodeOutputs, error) {
	payload := executionPayload(inputs)
	action := WorkflowAction{
		Description: "render and upload violation video",
		Payload: map[string]any{
			"cameraId":     stringValue(inputs["cameraId"], payloadLookupString(payload, "cam_id", "cameraId")),
			"cameraName":   stringValue(inputs["cameraName"], payloadLookupString(payload, "cam_name", "cameraName")),
			"fps":          intValue(inputs["fps"], 5),
			"frameId":      stringValue(inputs["imageId"], payloadLookupString(payload, "imgID", "frame_id", "imageId")),
			"message":      stringValue(inputs["message"], "Workflow violation"),
			"path":         stringValue(inputs["path"], defaultExternalRoute),
			"postEventSec": intValue(inputs["postEventSec"], 5),
			"preEventSec":  intValue(inputs["preEventSec"], 5),
			"source": map[string]any{
				"processedFrameKey": payloadLookupString(payload, "processed_frame_key"),
				"rawFrameKey":       payloadLookupString(payload, "raw_frame_key"),
			},
		},
		Subtopic:      "command",
		TargetService: videoRecorderService,
		Type:          "render-violation-video",
	}
	return NodeOutputs{
		"action":  action,
		"actions": []any{action},
		"started": true,
	}, nil
}

func saveViolationImageLocallyNode(inputs NodeInputs) (NodeOutputs, error) {
	payload := executionPayload(inputs)
	action := WorkflowAction{
		Description: "persist violation snapshots locally",
		Payload: map[string]any{
			"cameraId":   stringValue(inputs["cameraId"], payloadLookupString(payload, "cam_id", "cameraId")),
			"cameraName": stringValue(inputs["cameraName"], payloadLookupString(payload, "cam_name", "cameraName")),
			"frameId":    stringValue(inputs["imageId"], payloadLookupString(payload, "imgID", "frame_id", "imageId")),
			"message":    stringValue(inputs["message"], "Workflow violation"),
			"source": map[string]any{
				"processedFrameKey": payloadLookupString(payload, "processed_frame_key"),
				"rawFrameKey":       payloadLookupString(payload, "raw_frame_key"),
			},
		},
		Subtopic:      "command",
		TargetService: eventRecorderService,
		Type:          "save-image",
	}
	return NodeOutputs{
		"action":  action,
		"actions": []any{action},
		"saved":   true,
	}, nil
}

func uploadImageToCloudNode(inputs NodeInputs) (NodeOutputs, error) {
	outputs, err := sendViolationImageToCloudNode(inputs)
	if err != nil {
		return nil, err
	}
	outputs["uploaded"] = outputs["sent"]
	outputs["imageKey"] = payloadLookupString(firstMap(outputs, "payload"), "imageId", "frameId")
	delete(outputs, "sent")
	return outputs, nil
}

func uploadVideoToCloudNode(inputs NodeInputs) (NodeOutputs, error) {
	outputs, err := sendViolationVideoToCloudNode(inputs)
	if err != nil {
		return nil, err
	}
	outputs["uploaded"] = outputs["started"]
	outputs["videoKey"] = ""
	delete(outputs, "started")
	return outputs, nil
}

func uploadViolationToCloudNode(inputs NodeInputs) (NodeOutputs, error) {
	imageOutputs, err := sendViolationImageToCloudNode(inputs)
	if err != nil {
		return nil, err
	}
	actions := []any{imageOutputs["action"]}
	if boolValue(inputs["enableVideo"], true) {
		videoOutputs, videoErr := sendViolationVideoToCloudNode(inputs)
		if videoErr != nil {
			return nil, videoErr
		}
		actions = append(actions, videoOutputs["action"])
	}
	return NodeOutputs{
		"actions":  actions,
		"imageKey": payloadLookupString(firstMap(imageOutputs, "payload"), "imageId", "frameId"),
		"uploaded": true,
		"videoKey": "",
	}, nil
}
