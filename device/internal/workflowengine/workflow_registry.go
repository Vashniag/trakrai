package workflowengine

import (
	"fmt"
	"sync"
)

type NodeFunc func(NodeInputs) (NodeOutputs, error)

type nodeEntry struct {
	definition NodeDefinition
	fn         NodeFunc
}

type NodeRegistry struct {
	mu    sync.RWMutex
	nodes map[string]nodeEntry
}

func NewNodeRegistry() *NodeRegistry {
	return &NodeRegistry{nodes: make(map[string]nodeEntry)}
}

func (r *NodeRegistry) Register(definition NodeDefinition, fn NodeFunc) error {
	if fn == nil {
		return fmt.Errorf("node function is required")
	}
	if definition.NodeTypeID == "" {
		return fmt.Errorf("node_type_id is required")
	}
	if definition.DisplayName == "" {
		definition.DisplayName = definition.NodeTypeID
	}
	if definition.Version == "" {
		definition.Version = "1.0.0"
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	r.nodes[definition.NodeTypeID] = nodeEntry{definition: definition, fn: fn}
	return nil
}

func (r *NodeRegistry) MustRegister(definition NodeDefinition, fn NodeFunc) {
	if err := r.Register(definition, fn); err != nil {
		panic(err)
	}
}

func (r *NodeRegistry) Definition(nodeType string) (NodeDefinition, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	entry, ok := r.nodes[nodeType]
	return entry.definition, ok
}

func (r *NodeRegistry) Execute(nodeType string, inputs NodeInputs) (NodeOutputs, error) {
	r.mu.RLock()
	entry, ok := r.nodes[nodeType]
	r.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("node type %q is not registered", nodeType)
	}
	return entry.fn(inputs)
}

var (
	builtinsOnce     sync.Once
	builtinNodeStore *NodeRegistry
)

func builtinRegistry() *NodeRegistry {
	builtinsOnce.Do(func() {
		registry := NewNodeRegistry()
		registerBuiltinNodes(registry)
		builtinNodeStore = registry
	})
	return builtinNodeStore
}
