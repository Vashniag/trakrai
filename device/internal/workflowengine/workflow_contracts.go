package workflowengine

import "time"

type NodeInputs map[string]any
type NodeOutputs map[string]any

type NodeCategory string

const (
	NodeCategoryAction     NodeCategory = "action"
	NodeCategoryAggregator NodeCategory = "aggregator"
	NodeCategoryCondition  NodeCategory = "condition"
	NodeCategoryDataSource NodeCategory = "data-source"
	NodeCategoryFilter     NodeCategory = "filter"
	NodeCategoryTransform  NodeCategory = "transform"
	NodeCategoryTrigger    NodeCategory = "trigger"
	NodeCategoryUtility    NodeCategory = "utility"
)

type ExecutionStatus string

const (
	ExecutionStatusCompleted ExecutionStatus = "completed"
	ExecutionStatusFailed    ExecutionStatus = "failed"
	ExecutionStatusPending   ExecutionStatus = "pending"
	ExecutionStatusRunning   ExecutionStatus = "running"
	ExecutionStatusSkipped   ExecutionStatus = "skipped"
)

type PortDefinition struct {
	DataType     string `json:"data_type,omitempty"`
	Default      any    `json:"default,omitempty"`
	Description  string `json:"description,omitempty"`
	Name         string `json:"name"`
	PortType     string `json:"port_type,omitempty"`
	Required     bool   `json:"required,omitempty"`
	SpecialField string `json:"special_field,omitempty"`
}

type NodeDefinition struct {
	Category    NodeCategory     `json:"category"`
	Description string           `json:"description,omitempty"`
	DisplayName string           `json:"display_name"`
	Inputs      []PortDefinition `json:"inputs,omitempty"`
	NodeTypeID  string           `json:"node_type_id"`
	Outputs     []PortDefinition `json:"outputs,omitempty"`
	Version     string           `json:"version,omitempty"`
}

func (d NodeDefinition) inputDefaults() map[string]any {
	defaults := make(map[string]any)
	for _, input := range d.Inputs {
		if input.Name == "" || input.Default == nil {
			continue
		}
		defaults[input.Name] = input.Default
	}
	return defaults
}

type NodePosition struct {
	X float64 `json:"x,omitempty"`
	Y float64 `json:"y,omitempty"`
}

type NodeData struct {
	Configuration map[string]any `json:"configuration,omitempty"`
	Label         string         `json:"label,omitempty"`
}

type WorkflowNode struct {
	Data     NodeData       `json:"data"`
	ID       string         `json:"id"`
	Measured map[string]any `json:"measured,omitempty"`
	Position NodePosition   `json:"position"`
	Type     string         `json:"type"`
}

type WorkflowEdge struct {
	Animated     bool           `json:"animated,omitempty"`
	Data         map[string]any `json:"data,omitempty"`
	ID           string         `json:"id,omitempty"`
	Source       string         `json:"source"`
	SourceHandle string         `json:"sourceHandle,omitempty"`
	Target       string         `json:"target"`
	TargetHandle string         `json:"targetHandle,omitempty"`
	Type         string         `json:"type,omitempty"`
}

type WorkflowDefinition struct {
	Edges    []WorkflowEdge `json:"edges"`
	Metadata map[string]any `json:"metadata,omitempty"`
	Nodes    []WorkflowNode `json:"nodes"`
}

func (d *WorkflowDefinition) normalize() {
	if d.Metadata == nil {
		d.Metadata = make(map[string]any)
	}
	for index := range d.Nodes {
		if d.Nodes[index].Data.Configuration == nil {
			d.Nodes[index].Data.Configuration = make(map[string]any)
		}
	}
	for index := range d.Edges {
		if d.Edges[index].Data == nil {
			d.Edges[index].Data = make(map[string]any)
		}
	}
}

type WorkflowAction struct {
	Description   string         `json:"description,omitempty"`
	Metadata      map[string]any `json:"metadata,omitempty"`
	Payload       any            `json:"payload,omitempty"`
	Subtopic      string         `json:"subtopic,omitempty"`
	TargetService string         `json:"target_service"`
	Type          string         `json:"type"`
}

type NodeResult struct {
	DurationMs float64         `json:"duration_ms"`
	Error      string          `json:"error,omitempty"`
	NodeID     string          `json:"node_id"`
	NodeType   string          `json:"node_type"`
	Outputs    map[string]any  `json:"outputs,omitempty"`
	Status     ExecutionStatus `json:"status"`
}

type WorkflowExecutionResult struct {
	Actions      []WorkflowAction          `json:"actions,omitempty"`
	DurationMs   float64                   `json:"duration_ms"`
	Errors       []string                  `json:"errors,omitempty"`
	ExecutionID  string                    `json:"execution_id"`
	NodeResults  map[string]NodeResult     `json:"node_results"`
	Outputs      map[string]map[string]any `json:"outputs,omitempty"`
	Success      bool                      `json:"success"`
	WorkflowName string                    `json:"workflow_name,omitempty"`
}

type WorkflowExecutionContext struct {
	ExecutionID  string
	Frame        *WorkflowFrame
	Payload      map[string]any
	StartedAt    time.Time
	WorkflowName string
}
