import { useCallback, useMemo } from 'react';

import { ScrollArea } from '@trakrai/design-system/components/scroll-area';

import { ConfigurationSection } from './configuration-section';

import { useFlow } from '../../flow-context';
import { useSidebarTabAutoSelect } from '../sidebar-context';
import { createFluxerySidebarTab } from '../sidebar-tab';
import { useNodeSchemaData } from '../use-node-schema';

const SidebarInfoTabContent = () => {
  const {
    selectedNode,
    nodeRuntime,
    specialFields,
    workflow,
    flow: { nodes: flowNodes, edges: flowEdges },
    isReadOnly,
  } = useFlow();
  const selectedNodeData = useMemo(() => {
    return flowNodes.find((node) => node.id === selectedNode);
  }, [flowNodes, selectedNode]);
  const nodeSchemaState = useNodeSchemaData({
    id: selectedNode,
    edges: flowEdges,
    nodeRuntime,
    nodes: flowNodes,
  });

  const deleteEdge = useCallback(
    (edgeId: string) => {
      workflow.setEdges((currentEdges) => currentEdges.filter((edge) => edge.id !== edgeId));
    },
    [workflow],
  );
  const replaceNode = useCallback(
    (nodeId: string, nextNode: (typeof flowNodes)[number]) => {
      workflow.setNodes((currentNodes) =>
        currentNodes.map((node) => (node.id === nodeId ? nextNode : node)),
      );
    },
    [workflow],
  );
  const configurationFields = useMemo(() => {
    return nodeSchemaState.resolvedNodeSchema?.configurationFields ?? [];
  }, [nodeSchemaState.resolvedNodeSchema?.configurationFields]);

  if (selectedNodeData === undefined) {
    return (
      <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
        Select a node to view details
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 px-4 pt-4">
      <ScrollArea className="h-full min-h-0">
        <ConfigurationSection
          allInputs={nodeSchemaState.allInputs}
          configurationFields={configurationFields}
          isReadOnly={isReadOnly}
          nodeData={selectedNodeData}
          nodeEdges={nodeSchemaState.nodeEdges}
          specialFields={specialFields}
          onDeleteEdge={deleteEdge}
          onReplaceNode={replaceNode}
        />
      </ScrollArea>
    </div>
  );
};

/**
 * Pre-built sidebar tab for viewing and editing the selected node's configuration.
 *
 * Automatically switches to this tab when a node is selected. Displays
 * handler-defined configuration fields, edge-connected inputs, and configurable
 * inputs with add/edit/remove capabilities.
 *
 * @example
 * ```tsx
 * <FluxerySidebar>
 *   <SidebarInfoTab />
 * </FluxerySidebar>
 * ```
 */
export const SidebarInfoTab = createFluxerySidebarTab({
  id: 'info',
  label: 'Info',
  contentClassName: 'min-h-0 h-full',
  useAutoSelect: () => {
    const { selectedNode } = useFlow();
    useSidebarTabAutoSelect('info', selectedNode);
  },
  render: () => <SidebarInfoTabContent />,
});
