package workflowengine

import "testing"

func TestWorkflowEngineExecutesLegacyAlertFlow(t *testing.T) {
	t.Parallel()

	engine := NewWorkflowEngine(builtinRegistry())
	if err := engine.LoadDefinition(WorkflowDefinition{
		Nodes: []WorkflowNode{
			{ID: "det_input", Type: "detection-input", Data: NodeData{Configuration: map[string]any{}}},
			{ID: "count", Type: "check-count", Data: NodeData{Configuration: map[string]any{
				"checkType": "person_count",
				"classes":   []any{"person"},
				"operator":  ">",
				"threshold": 0,
			}}},
			{ID: "alert", Type: "generate-alert", Data: NodeData{Configuration: map[string]any{
				"message": "Person detected in frame",
			}}},
			{ID: "audio", Type: "generate-audio-text", Data: NodeData{Configuration: map[string]any{
				"prefix": "Attention!",
			}}},
		},
		Edges: []WorkflowEdge{
			{Source: "det_input", SourceHandle: "detections", Target: "count", TargetHandle: "detections"},
			{Source: "count", SourceHandle: "violations", Target: "alert", TargetHandle: "violations"},
			{Source: "det_input", SourceHandle: "cameraId", Target: "alert", TargetHandle: "cameraId"},
			{Source: "det_input", SourceHandle: "cameraName", Target: "alert", TargetHandle: "cameraName"},
			{Source: "count", SourceHandle: "violated", Target: "alert", TargetHandle: "trigger", Type: "conditionalEdge", Data: map[string]any{"configuration": true}},
			{Source: "count", SourceHandle: "violations", Target: "audio", TargetHandle: "violations"},
			{Source: "det_input", SourceHandle: "cameraName", Target: "audio", TargetHandle: "cameraName"},
			{Source: "count", SourceHandle: "violated", Target: "audio", TargetHandle: "trigger", Type: "conditionalEdge", Data: map[string]any{"configuration": true}},
		},
	}, "alert-flow"); err != nil {
		t.Fatalf("load definition failed: %v", err)
	}

	result, err := engine.Execute(nil, map[string]any{
		"DetectionPerClass": map[string]any{"person": 1},
		"bbox": []any{
			map[string]any{"label": "person", "conf": 0.91, "xyxy": []any{0.1, 0.1, 0.3, 0.7}},
		},
		"cam_id":   "cam-101",
		"cam_name": "Gate-101",
		"frame_id": "frame-101",
	})
	if err != nil {
		t.Fatalf("execute failed: %v", err)
	}

	if !result.Success {
		t.Fatalf("expected success, got errors: %v", result.Errors)
	}
	if result.NodeResults["alert"].Status != ExecutionStatusCompleted {
		t.Fatalf("expected alert node to complete, got %s", result.NodeResults["alert"].Status)
	}
	if result.NodeResults["audio"].Status != ExecutionStatusCompleted {
		t.Fatalf("expected audio node to complete, got %s", result.NodeResults["audio"].Status)
	}
	if stringValue(result.NodeResults["alert"].Outputs["violationText"], "") != "Person detected in frame" {
		t.Fatalf("unexpected violation text: %#v", result.NodeResults["alert"].Outputs["violationText"])
	}
	if stringValue(result.NodeResults["audio"].Outputs["text"], "") == "" {
		t.Fatal("expected audio text to be populated")
	}
}

func TestWorkflowEngineSkipsConditionalNodesWhenTriggerFalse(t *testing.T) {
	t.Parallel()

	engine := NewWorkflowEngine(builtinRegistry())
	if err := engine.LoadDefinition(WorkflowDefinition{
		Nodes: []WorkflowNode{
			{ID: "det_input", Type: "detection-input", Data: NodeData{Configuration: map[string]any{}}},
			{ID: "count", Type: "check-count", Data: NodeData{Configuration: map[string]any{
				"classes":   []any{"person"},
				"operator":  ">",
				"threshold": 0,
			}}},
			{ID: "alert", Type: "generate-alert", Data: NodeData{Configuration: map[string]any{}}},
		},
		Edges: []WorkflowEdge{
			{Source: "det_input", SourceHandle: "detections", Target: "count", TargetHandle: "detections"},
			{Source: "count", SourceHandle: "violations", Target: "alert", TargetHandle: "violations"},
			{Source: "count", SourceHandle: "violated", Target: "alert", TargetHandle: "trigger", Type: "conditionalEdge", Data: map[string]any{"configuration": true}},
		},
	}, "skip-flow"); err != nil {
		t.Fatalf("load definition failed: %v", err)
	}

	result, err := engine.Execute(nil, map[string]any{
		"DetectionPerClass": map[string]any{"helmet": 1},
		"bbox": []any{
			map[string]any{"label": "helmet", "conf": 0.88, "xyxy": []any{0.2, 0.2, 0.4, 0.4}},
		},
		"cam_id":   "cam-102",
		"cam_name": "Gate-102",
		"frame_id": "frame-102",
	})
	if err != nil {
		t.Fatalf("execute failed: %v", err)
	}

	if !result.Success {
		t.Fatalf("expected success, got errors: %v", result.Errors)
	}
	if result.NodeResults["count"].Outputs["violated"] != false {
		t.Fatalf("expected count node to be false, got %#v", result.NodeResults["count"].Outputs["violated"])
	}
	if result.NodeResults["alert"].Status != ExecutionStatusSkipped {
		t.Fatalf("expected alert node to be skipped, got %s", result.NodeResults["alert"].Status)
	}
}
