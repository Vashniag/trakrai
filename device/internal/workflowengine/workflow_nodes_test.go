package workflowengine

import "testing"

func TestROIHelpersMatchAndFilter(t *testing.T) {
	t.Parallel()

	roiOutputs, err := roiInputNode(NodeInputs{
		"__context__": &WorkflowExecutionContext{
			Payload: map[string]any{
				"cam_id":   "7",
				"cam_name": "Gate Camera",
				"roi_config": []any{
					map[string]any{
						"alert_time_pause": 10,
						"enable_alert":     true,
						"enable_speaker":   false,
						"name":             "Entry Zone",
						"monitor_keywords": []any{"PPE Compliance"},
						"points":           []any{"0.0,0.0", "0.5,0.0", "0.5,1.0", "0.0,1.0"},
						"selector":         "7::1::3",
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("roi input failed: %v", err)
	}
	if roiOutputs["roiCount"] != 1 {
		t.Fatalf("expected one roi, got %#v", roiOutputs["roiCount"])
	}

	filtered, err := filterROIByNameNode(NodeInputs{
		"name": "7::1::3",
		"rois": roiOutputs["rois"],
	})
	if err != nil {
		t.Fatalf("filter roi failed: %v", err)
	}
	if filtered["found"] != true {
		t.Fatalf("expected roi to be found, got %#v", filtered["found"])
	}

	settings, err := getROIAlertSettingsNode(NodeInputs{"roi": filtered["roi"]})
	if err != nil {
		t.Fatalf("get roi alert settings failed: %v", err)
	}
	if settings["enableSpeaker"] != false {
		t.Fatalf("expected speaker to be disabled, got %#v", settings["enableSpeaker"])
	}

	detections, err := filterDetectionsByROINode(NodeInputs{
		"detections": []any{
			map[string]any{"label": "person", "xyxy": []any{0.1, 0.1, 0.3, 0.7}},
			map[string]any{"label": "truck", "xyxy": []any{0.7, 0.1, 0.9, 0.4}},
		},
		"roi": filtered["roi"],
	})
	if err != nil {
		t.Fatalf("filter detections by roi failed: %v", err)
	}
	if detections["insideCount"] != 1 {
		t.Fatalf("expected one detection inside roi, got %#v", detections["insideCount"])
	}
}

func TestActionNodesEmitServiceRequests(t *testing.T) {
	t.Parallel()

	context := &WorkflowExecutionContext{
		Payload: map[string]any{
			"cam_id":              "cam-42",
			"cam_name":            "Dock-42",
			"frame_id":            "frame-42",
			"imgID":               "frame-42",
			"processed_frame_key": "camera:dock-42:processed",
			"raw_frame_key":       "camera:dock-42:raw",
		},
	}
	violations := []any{
		map[string]any{"check_type": "person_count", "message": "Person detected", "severity": "warning"},
	}

	audioOutputs, err := enqueueSpeakerAudioTaskNode(NodeInputs{
		"__context__":    context,
		"cameraId":       "cam-42",
		"cameraName":     "Dock-42",
		"message":        "Attention! Person detected.",
		"speakerAddress": "speaker-1",
		"violations":     violations,
	})
	if err != nil {
		t.Fatalf("enqueue speaker audio task failed: %v", err)
	}
	audioAction, ok := normalizeAction(audioOutputs["action"])
	if !ok {
		t.Fatal("expected audio action to normalize")
	}
	if audioAction.TargetService != audioAlertServiceName {
		t.Fatalf("unexpected audio target service: %s", audioAction.TargetService)
	}

	uploadOutputs, err := uploadViolationToCloudNode(NodeInputs{
		"__context__": context,
		"cameraId":    "cam-42",
		"cameraName":  "Dock-42",
		"enableVideo": true,
		"path":        defaultExternalRoute,
		"violations":  violations,
	})
	if err != nil {
		t.Fatalf("upload violation failed: %v", err)
	}
	actions := actionsFromOutputs(map[string]any{"actions": uploadOutputs["actions"]})
	if len(actions) != 2 {
		t.Fatalf("expected 2 actions, got %d", len(actions))
	}
	if actions[0].TargetService != cloudCommServiceName {
		t.Fatalf("unexpected cloud target service: %s", actions[0].TargetService)
	}
	if actions[1].TargetService != videoRecorderService {
		t.Fatalf("unexpected video target service: %s", actions[1].TargetService)
	}
}
