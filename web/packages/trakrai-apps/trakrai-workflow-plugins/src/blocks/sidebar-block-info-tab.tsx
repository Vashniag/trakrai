'use client';

import { useMemo } from 'react';

import { Badge } from '@trakrai/design-system/components/badge';
import { Button } from '@trakrai/design-system/components/button';
import { ScrollArea } from '@trakrai/design-system/components/scroll-area';
import {
  type FluxeryConfigRecord,
  type FluxeryConfigValue,
  RegularField,
  createFluxerySidebarTab,
  useFlow,
  useSidebarTabAutoSelect,
} from '@trakrai-workflow/ui';
import { X } from 'lucide-react';

import { useBlocks } from './blocks-context';

import type { Edge, Node } from '@trakrai-workflow/core';
import type { z } from 'zod';

type JSONSchema = z.core.JSONSchema.JSONSchema;

type BlockTargetField = {
  key: string;
  label: string;
  nodeId: string;
  portId: string;
  schema: JSONSchema;
};

const getDefaultValue = (type: string | undefined): FluxeryConfigValue => {
  switch (type) {
    case undefined:
      return '';
    case 'array':
      return [];
    case 'boolean':
      return false;
    case 'number':
    case 'integer':
      return 0;
    case 'object':
      return {};
    default:
      return '';
  }
};

const SummaryBadge = ({ label, value }: { label: string; value: number }) => (
  <Badge className="rounded-none" variant="secondary">
    {value} {label}
  </Badge>
);

const getReadableEdgeSources = (connectedEdges: Edge[]) =>
  Array.from(
    new Set(
      connectedEdges.map((edge) => {
        if (
          edge.sourceHandle === undefined ||
          edge.sourceHandle === null ||
          edge.sourceHandle === ''
        ) {
          return edge.source;
        }
        return `${edge.source}.${edge.sourceHandle}`;
      }),
    ),
  );

const findNodeConfigurationValue = (nodes: Node[], nodeId: string, key: string) => {
  const node = nodes.find((currentNode) => currentNode.id === nodeId);
  const configuration = node?.data.configuration;
  if (
    configuration === null ||
    configuration === undefined ||
    Array.isArray(configuration) ||
    typeof configuration !== 'object'
  ) {
    return undefined;
  }
  return configuration[key] as FluxeryConfigValue | undefined;
};

const SidebarBlockInfoTabContent = () => {
  const flow = useFlow();
  const blocks = useBlocks();
  const { isReadOnly, nodeRuntime, specialFields, theme, workflow } = flow;
  const { selectedBlock } = blocks;

  const targetFields = useMemo<BlockTargetField[]>(() => {
    if (selectedBlock === null) {
      return [];
    }

    return [
      ...selectedBlock.inputs.map((input) => ({
        key: input.handle,
        label: input.label,
        nodeId: input.nodeId,
        portId: input.portId,
        schema: nodeRuntime.resolveNodeSchemaById(input.nodeId)?.input.properties[input.handle] as
          | JSONSchema
          | undefined,
      })),
      ...selectedBlock.configFields.map((field) => ({
        key: field.key,
        label: field.label,
        nodeId: field.nodeId,
        portId: field.portId,
        schema: nodeRuntime.resolveNodeSchemaById(field.nodeId)?.input.properties[field.key] as
          | JSONSchema
          | undefined,
      })),
    ]
      .filter(
        (field): field is BlockTargetField =>
          field.schema !== undefined &&
          typeof field.schema === 'object' &&
          !Array.isArray(field.schema),
      )
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [nodeRuntime, selectedBlock]);

  const connectedEdgesByPortId = useMemo(() => {
    const byPortId = new Map<string, Edge[]>();
    if (selectedBlock === null) {
      return byPortId;
    }

    const blockNodeIds = new Set(selectedBlock.nodeIds);
    for (const field of targetFields) {
      const connectedEdges = workflow.edges.filter(
        (edge) =>
          edge.target === field.nodeId &&
          edge.targetHandle === field.key &&
          !blockNodeIds.has(edge.source),
      );
      if (connectedEdges.length > 0) {
        byPortId.set(field.portId, connectedEdges);
      }
    }
    return byPortId;
  }, [selectedBlock, targetFields, workflow.edges]);

  if (selectedBlock === null) {
    return (
      <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
        Select a block to view details
      </div>
    );
  }

  const updateTargetValue = (
    field: BlockTargetField,
    nextValue: FluxeryConfigValue | undefined,
  ) => {
    workflow.setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== field.nodeId) {
          return node;
        }
        const currentConfiguration =
          node.data.configuration !== null &&
          node.data.configuration !== undefined &&
          !Array.isArray(node.data.configuration) &&
          typeof node.data.configuration === 'object'
            ? node.data.configuration
            : {};
        const nextConfiguration = { ...currentConfiguration };
        nextConfiguration[field.key] = nextValue;
        return {
          ...node,
          data: {
            ...node.data,
            configuration: nextConfiguration,
          },
        };
      }),
    );
  };

  const removeTargetValue = (field: BlockTargetField) => {
    workflow.setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== field.nodeId) {
          return node;
        }
        const currentConfiguration = node.data.configuration;
        if (
          currentConfiguration === null ||
          currentConfiguration === undefined ||
          Array.isArray(currentConfiguration) ||
          typeof currentConfiguration !== 'object' ||
          !(field.key in currentConfiguration)
        ) {
          return node;
        }
        const nextConfiguration = { ...currentConfiguration };
        delete nextConfiguration[field.key];
        return {
          ...node,
          data: {
            ...node.data,
            configuration: nextConfiguration,
          },
        };
      }),
    );
  };

  const removeConnectedTargetEdges = (field: BlockTargetField) => {
    const edgesToRemove = connectedEdgesByPortId.get(field.portId) ?? [];
    if (edgesToRemove.length === 0) {
      return;
    }
    const edgeIds = new Set(edgesToRemove.map((edge) => edge.id));
    workflow.setEdges((currentEdges) => currentEdges.filter((edge) => !edgeIds.has(edge.id)));
  };

  return (
    <div className="flex h-full w-full flex-col gap-4 px-4 pt-4">
      <ScrollArea className="h-full min-h-0">
        <div className="space-y-4 pb-4">
          <section className="space-y-3 border p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">{selectedBlock.name}</h3>
                <p className="text-muted-foreground text-xs">
                  {selectedBlock.nodes.length} internal nodes
                </p>
              </div>
              {blocks.scopedBlockId === selectedBlock.blockId ? (
                <Button size="sm" type="button" variant="outline" onClick={blocks.exitScope}>
                  Exit Scope
                </Button>
              ) : (
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => {
                    blocks.enterScope(selectedBlock.blockId);
                  }}
                >
                  Scope In
                </Button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <SummaryBadge label="targets" value={targetFields.length} />
              <SummaryBadge label="outputs" value={selectedBlock.outputs.length} />
              <SummaryBadge label="nodes" value={selectedBlock.nodes.length} />
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Configuration</h3>
            </div>
            {targetFields.length === 0 ? (
              <div className="border border-dashed p-4 text-center">
                <p className="text-muted-foreground text-sm">
                  No configuration available for this block.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {targetFields.map((field) => {
                  const connectedEdges = connectedEdgesByPortId.get(field.portId) ?? [];
                  const currentValue = findNodeConfigurationValue(
                    workflow.nodes,
                    field.nodeId,
                    field.key,
                  );
                  const isConfigured = currentValue !== undefined;

                  if (connectedEdges.length > 0) {
                    return (
                      <div key={field.portId} className="space-y-2 border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">{field.label}</span>
                            <span className="text-muted-foreground text-xs">
                              Connected from: {getReadableEdgeSources(connectedEdges).join(', ')}
                            </span>
                          </div>
                          <Button
                            disabled={isReadOnly}
                            size="sm"
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              removeConnectedTargetEdges(field);
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  }

                  if (isConfigured) {
                    const currentNode =
                      workflow.nodes.find((node) => node.id === field.nodeId) ?? undefined;
                    return (
                      <RegularField
                        key={field.portId}
                        context={{
                          configuration:
                            currentNode?.data.configuration !== null &&
                            currentNode?.data.configuration !== undefined &&
                            !Array.isArray(currentNode.data.configuration) &&
                            typeof currentNode.data.configuration === 'object'
                              ? (currentNode.data.configuration as FluxeryConfigRecord)
                              : undefined,
                          node: currentNode,
                          schema: field.schema,
                          theme,
                        }}
                        disabled={isReadOnly}
                        propName={field.key}
                        schema={{
                          ...field.schema,
                          description:
                            typeof field.schema.description === 'string'
                              ? field.schema.description
                              : undefined,
                          title: field.label,
                        }}
                        specialFields={specialFields}
                        value={currentValue}
                        onChange={(nextValue) => {
                          updateTargetValue(field, nextValue as FluxeryConfigValue | undefined);
                        }}
                        onFieldRemove={() => {
                          removeTargetValue(field);
                        }}
                      />
                    );
                  }

                  const fieldDescription =
                    typeof field.schema.description === 'string' &&
                    field.schema.description.length > 0
                      ? field.schema.description
                      : undefined;

                  return (
                    <Button
                      key={field.portId}
                      className="h-auto w-full items-start justify-start border-dashed px-3 py-3 text-left whitespace-normal"
                      disabled={isReadOnly}
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={() => {
                        updateTargetValue(field, getDefaultValue(field.schema.type));
                      }}
                    >
                      <div className="flex w-full min-w-0 flex-col items-start gap-1">
                        <span className="w-full text-sm font-medium break-words">
                          {field.label}
                        </span>
                        <span className="text-muted-foreground w-full text-xs break-words whitespace-normal">
                          Unconfigured. Click to configure or connect an edge on the canvas.
                        </span>
                        {fieldDescription === undefined ? null : (
                          <span className="text-muted-foreground w-full text-xs break-words">
                            {fieldDescription}
                          </span>
                        )}
                      </div>
                    </Button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  );
};

/**
 * Sidebar tab that inspects and edits the currently selected block instance or scoped block.
 *
 * It reads block-derived inputs, outputs, and config metadata from {@link useBlocks}, so it should
 * only be used inside a {@link BlocksProvider} tree.
 */
export const SidebarBlockInfoTab = createFluxerySidebarTab({
  id: 'info',
  label: 'Info',
  contentClassName: 'min-h-0 h-full',
  useAutoSelect: () => {
    const blocks = useBlocks();
    useSidebarTabAutoSelect('info', blocks.scopedBlockId === null ? blocks.selectedBlockId : null);
  },
  render: () => <SidebarBlockInfoTabContent />,
});
