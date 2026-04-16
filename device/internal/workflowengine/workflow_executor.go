package workflowengine

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"time"
)

type edgeMapping struct {
	conditionalValue any
	isConditional    bool
	sourceHandle     string
	sourceNodeID     string
	targetHandle     string
	targetNodeID     string
}

type dag struct {
	adjacency       map[string][]string
	executionLevels [][]string
	incoming        map[string][]edgeMapping
	leafNodes       []string
	nodeIDs         []string
	reverse         map[string][]string
}

type WorkflowEngine struct {
	dag          *dag
	nodeMap      map[string]WorkflowNode
	registry     *NodeRegistry
	workflow     WorkflowDefinition
	workflowName string
}

func NewWorkflowEngine(registry *NodeRegistry) *WorkflowEngine {
	if registry == nil {
		registry = builtinRegistry()
	}
	return &WorkflowEngine{
		nodeMap:  make(map[string]WorkflowNode),
		registry: registry,
	}
}

func (e *WorkflowEngine) LoadDefinition(workflow WorkflowDefinition, workflowName string) error {
	workflow.normalize()
	graph, err := buildDAG(workflow)
	if err != nil {
		return err
	}
	e.dag = graph
	e.workflow = workflow
	e.workflowName = workflowName
	e.nodeMap = make(map[string]WorkflowNode, len(workflow.Nodes))
	for _, node := range workflow.Nodes {
		e.nodeMap[node.ID] = node
	}
	return nil
}

func (e *WorkflowEngine) LoadBytes(data []byte, workflowName string) error {
	var workflow WorkflowDefinition
	if err := json.Unmarshal(data, &workflow); err != nil {
		return fmt.Errorf("decode workflow definition: %w", err)
	}
	if workflowName == "" {
		workflowName = strings.TrimSpace(firstString(workflow.Metadata, "name", "workflow_name"))
	}
	return e.LoadDefinition(workflow, workflowName)
}

func (e *WorkflowEngine) Loaded() bool {
	return e.dag != nil && len(e.nodeMap) > 0
}

func (e *WorkflowEngine) Execute(frame *WorkflowFrame, payload map[string]any) (*WorkflowExecutionResult, error) {
	if !e.Loaded() {
		return nil, fmt.Errorf("workflow is not loaded")
	}

	startedAt := time.Now().UTC()
	executionID := fmt.Sprintf("wf-%d", startedAt.UnixNano())
	context := &WorkflowExecutionContext{
		ExecutionID:  executionID,
		Frame:        frame,
		Payload:      cloneMap(payload),
		StartedAt:    startedAt,
		WorkflowName: e.workflowName,
	}

	resultMap := make(map[string]NodeResult, len(e.nodeMap))
	outputMap := make(map[string]any)
	failedNodes := make(map[string]struct{})
	actions := make([]WorkflowAction, 0, 4)

	for _, level := range e.dag.executionLevels {
		for _, nodeID := range level {
			e.executeNode(nodeID, context, resultMap, outputMap, failedNodes, &actions)
		}
	}

	durationMs := float64(time.Since(startedAt)) / float64(time.Millisecond)
	execResult := &WorkflowExecutionResult{
		Actions:      actions,
		DurationMs:   durationMs,
		ExecutionID:  executionID,
		NodeResults:  resultMap,
		Outputs:      make(map[string]map[string]any),
		Success:      len(failedNodes) == 0,
		WorkflowName: e.workflowName,
	}

	for _, nodeID := range e.dag.leafNodes {
		result, ok := resultMap[nodeID]
		if !ok || result.Status != ExecutionStatusCompleted {
			continue
		}
		execResult.Outputs[nodeID] = cloneMap(result.Outputs)
	}

	for _, result := range resultMap {
		if result.Error != "" && result.Status == ExecutionStatusFailed {
			execResult.Errors = append(execResult.Errors, result.Error)
		}
	}
	slices.Sort(execResult.Errors)

	return execResult, nil
}

func (e *WorkflowEngine) executeNode(
	nodeID string,
	context *WorkflowExecutionContext,
	resultMap map[string]NodeResult,
	outputMap map[string]any,
	failedNodes map[string]struct{},
	actions *[]WorkflowAction,
) {
	node := e.nodeMap[nodeID]
	startedAt := time.Now()

	for _, upstreamID := range e.dag.reverse[nodeID] {
		if _, failed := failedNodes[upstreamID]; failed {
			resultMap[nodeID] = NodeResult{
				DurationMs: float64(time.Since(startedAt)) / float64(time.Millisecond),
				Error:      "Skipped: upstream dependency failed.",
				NodeID:     nodeID,
				NodeType:   node.Type,
				Status:     ExecutionStatusSkipped,
			}
			failedNodes[nodeID] = struct{}{}
			return
		}
	}

	for _, edge := range e.dag.incoming[nodeID] {
		if !edge.isConditional {
			continue
		}
		sourceOutput := outputMap[nodePortKey(edge.sourceNodeID, edge.sourceHandle)]
		if edge.conditionalValue != nil {
			if !reflect.DeepEqual(sourceOutput, edge.conditionalValue) {
				resultMap[nodeID] = NodeResult{
					DurationMs: float64(time.Since(startedAt)) / float64(time.Millisecond),
					Error: fmt.Sprintf(
						"Skipped: trigger from %s.%s value %#v != expected %#v.",
						edge.sourceNodeID,
						edge.sourceHandle,
						sourceOutput,
						edge.conditionalValue,
					),
					NodeID:   nodeID,
					NodeType: node.Type,
					Status:   ExecutionStatusSkipped,
				}
				return
			}
			continue
		}
		if !isTruthy(sourceOutput) {
			resultMap[nodeID] = NodeResult{
				DurationMs: float64(time.Since(startedAt)) / float64(time.Millisecond),
				Error: fmt.Sprintf(
					"Skipped: conditional edge from %s.%s is falsy.",
					edge.sourceNodeID,
					edge.sourceHandle,
				),
				NodeID:   nodeID,
				NodeType: node.Type,
				Status:   ExecutionStatusSkipped,
			}
			return
		}
	}

	inputs := make(NodeInputs)
	if definition, ok := e.registry.Definition(node.Type); ok {
		for key, value := range definition.inputDefaults() {
			inputs[key] = value
		}
	}
	for key, value := range node.Data.Configuration {
		inputs[key] = value
	}
	inputs["__context__"] = context

	for _, edge := range e.dag.incoming[nodeID] {
		if edge.targetHandle == "trigger" {
			continue
		}
		value, ok := outputMap[nodePortKey(edge.sourceNodeID, edge.sourceHandle)]
		if ok {
			inputs[edge.targetHandle] = value
		}
	}

	resultMap[nodeID] = NodeResult{
		NodeID:   nodeID,
		NodeType: node.Type,
		Status:   ExecutionStatusRunning,
	}

	outputs, err := e.registry.Execute(node.Type, inputs)
	durationMs := float64(time.Since(startedAt)) / float64(time.Millisecond)
	if err != nil {
		resultMap[nodeID] = NodeResult{
			DurationMs: durationMs,
			Error:      err.Error(),
			NodeID:     nodeID,
			NodeType:   node.Type,
			Status:     ExecutionStatusFailed,
		}
		failedNodes[nodeID] = struct{}{}
		return
	}

	for outputName, value := range outputs {
		outputMap[nodePortKey(nodeID, outputName)] = value
	}
	*actions = append(*actions, actionsFromOutputs(outputs)...)

	resultMap[nodeID] = NodeResult{
		DurationMs: durationMs,
		NodeID:     nodeID,
		NodeType:   node.Type,
		Outputs:    cloneMap(outputs),
		Status:     ExecutionStatusCompleted,
	}
}

func nodePortKey(nodeID string, handle string) string {
	return nodeID + ":" + handle
}

func buildDAG(workflow WorkflowDefinition) (*dag, error) {
	graph := &dag{
		adjacency: make(map[string][]string),
		incoming:  make(map[string][]edgeMapping),
		reverse:   make(map[string][]string),
	}
	for _, node := range workflow.Nodes {
		graph.nodeIDs = append(graph.nodeIDs, node.ID)
		if _, ok := graph.adjacency[node.ID]; !ok {
			graph.adjacency[node.ID] = nil
		}
		if _, ok := graph.reverse[node.ID]; !ok {
			graph.reverse[node.ID] = nil
		}
	}

	for _, edge := range workflow.Edges {
		isConditional := edge.TargetHandle == "trigger" || strings.EqualFold(edge.Type, "conditionalEdge")
		mapping := edgeMapping{
			conditionalValue: edgeConditionalValue(edge),
			isConditional:    isConditional,
			sourceHandle:     edge.SourceHandle,
			sourceNodeID:     edge.Source,
			targetHandle:     edge.TargetHandle,
			targetNodeID:     edge.Target,
		}
		graph.adjacency[edge.Source] = append(graph.adjacency[edge.Source], edge.Target)
		graph.reverse[edge.Target] = append(graph.reverse[edge.Target], edge.Source)
		graph.incoming[edge.Target] = append(graph.incoming[edge.Target], mapping)
	}

	inDegree := make(map[string]int, len(graph.nodeIDs))
	for _, nodeID := range graph.nodeIDs {
		inDegree[nodeID] = len(graph.reverse[nodeID])
	}

	queue := make([]string, 0, len(graph.nodeIDs))
	for _, nodeID := range graph.nodeIDs {
		if inDegree[nodeID] == 0 {
			queue = append(queue, nodeID)
		}
	}

	ordered := make([]string, 0, len(graph.nodeIDs))
	for len(queue) > 0 {
		currentLevel := append([]string(nil), queue...)
		graph.executionLevels = append(graph.executionLevels, currentLevel)
		queue = queue[:0]

		for _, nodeID := range currentLevel {
			ordered = append(ordered, nodeID)
			for _, downstream := range graph.adjacency[nodeID] {
				inDegree[downstream]--
				if inDegree[downstream] == 0 {
					queue = append(queue, downstream)
				}
			}
		}
	}

	if len(ordered) != len(graph.nodeIDs) {
		return nil, fmt.Errorf("workflow contains a cycle")
	}

	for _, nodeID := range graph.nodeIDs {
		if len(graph.adjacency[nodeID]) == 0 {
			graph.leafNodes = append(graph.leafNodes, nodeID)
		}
	}

	return graph, nil
}

func edgeConditionalValue(edge WorkflowEdge) any {
	if len(edge.Data) == 0 {
		return nil
	}
	if value, ok := edge.Data["configuration"]; ok {
		return value
	}
	if value, ok := edge.Data["conditional"]; ok {
		return value
	}
	if value, ok := edge.Data["value"]; ok {
		return value
	}
	return nil
}

func actionsFromOutputs(outputs map[string]any) []WorkflowAction {
	var actions []WorkflowAction
	appendAction := func(value any) {
		action, ok := normalizeAction(value)
		if ok && action.TargetService != "" && action.Type != "" {
			actions = append(actions, action)
		}
	}

	if value, ok := outputs["action"]; ok {
		appendAction(value)
	}
	if value, ok := outputs["actions"]; ok {
		switch typed := value.(type) {
		case []WorkflowAction:
			for _, action := range typed {
				appendAction(action)
			}
		case []any:
			for _, item := range typed {
				appendAction(item)
			}
		}
	}
	return actions
}

func normalizeAction(value any) (WorkflowAction, bool) {
	switch typed := value.(type) {
	case WorkflowAction:
		return typed, true
	case map[string]any:
		action := WorkflowAction{
			Description:   strings.TrimSpace(firstString(typed, "description")),
			Metadata:      firstMap(typed, "metadata"),
			Payload:       typed["payload"],
			Subtopic:      strings.TrimSpace(firstString(typed, "subtopic")),
			TargetService: strings.TrimSpace(firstString(typed, "target_service", "targetService")),
			Type:          strings.TrimSpace(firstString(typed, "type")),
		}
		return action, action.TargetService != "" && action.Type != ""
	default:
		return WorkflowAction{}, false
	}
}

func isTruthy(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case string:
		return strings.TrimSpace(typed) != ""
	case int:
		return typed != 0
	case int64:
		return typed != 0
	case float64:
		return typed != 0
	case []any:
		return len(typed) > 0
	case map[string]any:
		return len(typed) > 0
	default:
		return true
	}
}

func cloneMap(input map[string]any) map[string]any {
	if len(input) == 0 {
		return map[string]any{}
	}
	output := make(map[string]any, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

type workflowLoader struct {
	engine         *WorkflowEngine
	lastCheckedAt  time.Time
	lastModTime    time.Time
	path           string
	reloadInterval time.Duration
	workflowName   string
}

func newWorkflowLoader(cfg WorkflowConfig, registry *NodeRegistry) *workflowLoader {
	interval := time.Duration(cfg.ReloadIntervalSec) * time.Second
	if interval <= 0 {
		interval = 5 * time.Second
	}
	return &workflowLoader{
		engine:         NewWorkflowEngine(registry),
		path:           filepath.Clean(strings.TrimSpace(cfg.DefinitionPath)),
		reloadInterval: interval,
	}
}

func (l *workflowLoader) ensureLoaded() (*WorkflowEngine, string, error) {
	if strings.TrimSpace(l.path) == "" {
		return nil, "", nil
	}

	now := time.Now()
	if l.engine.Loaded() && now.Sub(l.lastCheckedAt) < l.reloadInterval {
		return l.engine, l.workflowName, nil
	}
	l.lastCheckedAt = now

	info, err := os.Stat(l.path)
	if err != nil {
		return nil, "", fmt.Errorf("stat workflow definition: %w", err)
	}
	modTime := info.ModTime().UTC()
	if l.engine.Loaded() && modTime.Equal(l.lastModTime) {
		return l.engine, l.workflowName, nil
	}

	bytes, err := os.ReadFile(l.path)
	if err != nil {
		return nil, "", fmt.Errorf("read workflow definition: %w", err)
	}
	workflowName := strings.TrimSuffix(filepath.Base(l.path), filepath.Ext(l.path))
	if err := l.engine.LoadBytes(bytes, workflowName); err != nil {
		return nil, "", err
	}
	l.lastModTime = modTime
	l.workflowName = l.engine.workflowName
	if l.workflowName == "" {
		l.workflowName = workflowName
	}
	return l.engine, l.workflowName, nil
}

func buildWorkflowPayload(frame *WorkflowFrame) map[string]any {
	payload := cloneMap(frame.Detections.Raw)
	if payload == nil {
		payload = make(map[string]any)
	}

	payload["cam_id"] = firstNonEmptyString(payload, frame.Detections.CameraID, frame.Envelope.SourceCamID)
	payload["cam_name"] = firstNonEmptyString(payload, frame.Detections.CameraName, frame.Envelope.CameraName)
	payload["cameraId"] = payload["cam_id"]
	payload["cameraName"] = payload["cam_name"]
	payload["frame_id"] = firstNonEmptyString(payload, frame.Detections.FrameID, frame.Envelope.FrameID)
	payload["imgID"] = firstNonEmptyString(payload, frame.Detections.ImageID, frame.Envelope.ImageID, frame.Detections.FrameID)
	payload["image_id"] = payload["imgID"]
	payload["raw_frame_key"] = frame.Envelope.RawFrameKey
	payload["processed_frame_key"] = frame.Envelope.ProcessedFrameKey
	payload["source_cam_id"] = frame.Envelope.SourceCamID
	payload["queue_latency_ms"] = frame.QueueLatency.Milliseconds()
	payload["system_detection_time"] = frame.Detections.SystemDetectionTime.Format(time.RFC3339Nano)

	metadata := cloneMap(frame.Envelope.Metadata)
	for key, value := range frame.Detections.Metadata {
		metadata[key] = value
	}
	if len(metadata) > 0 {
		payload["metadata"] = metadata
	}
	if _, ok := payload["roi_config"]; !ok {
		if value, ok := metadata["roi_config"]; ok {
			payload["roi_config"] = value
		} else if value, ok := metadata["rois"]; ok {
			payload["roi_config"] = value
		}
	}
	if _, ok := payload["ptz_base_index"]; !ok {
		if value, ok := metadata["ptz_base_index"]; ok {
			payload["ptz_base_index"] = value
		} else if value, ok := metadata["locationIndex"]; ok {
			payload["ptz_base_index"] = value
		}
	}

	normalizedBoxes := make([]any, 0, len(frame.Detections.Boxes))
	for _, box := range frame.Detections.Boxes {
		detection := cloneMap(box.Data)
		if detection == nil {
			detection = make(map[string]any)
		}
		detection["label"] = box.Label
		detection["conf"] = box.Confidence
		if len(box.RawBBoxes) > 0 {
			values := make([]any, 0, len(box.RawBBoxes))
			for _, item := range box.RawBBoxes {
				values = append(values, item)
			}
			detection["raw_bboxes"] = values
			if _, ok := detection["xyxy"]; !ok {
				detection["xyxy"] = values
			}
		}
		normalizedBoxes = append(normalizedBoxes, detection)
	}
	payload["bbox"] = normalizedBoxes
	payload["DetectionPerClass"] = frame.Detections.DetectionPerClass
	payload["totalDetection"] = frame.Detections.TotalDetection

	return payload
}

func firstNonEmptyString(payload map[string]any, values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
