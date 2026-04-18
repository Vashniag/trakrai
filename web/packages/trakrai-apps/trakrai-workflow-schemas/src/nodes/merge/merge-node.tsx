'use client';

import { useCallback, useEffect, useMemo } from 'react';

import { Button } from '@trakrai/design-system/components/button';
import { cn } from '@trakrai/design-system/lib/utils';
import { getNodeConfiguration, jsonSchemaToTypeString } from '@trakrai-workflow/core';
import { createDisplayName } from '@trakrai-workflow/core/utils';
import { LabeledHandle, SchemaNodeShell, useFlow, useNodeSchemaData } from '@trakrai-workflow/ui';
import { Position, useNodeId, useReactFlow, useUpdateNodeInternals } from '@xyflow/react';
import { Plus, X } from 'lucide-react';

import {
  buildMergeHandleId,
  getMergeInputsFromConfig,
  MERGE_HANDLE_SEPARATOR,
  MERGE_INPUTS_KEY,
  type MergeInputDefinition,
} from './merge-node-utils';

import type { z } from 'zod';

type JSONSchema = z.core.JSONSchema.JSONSchema;

type MergeHandleProps = {
  handleId: string;
  label: string;
  type: 'input' | 'output';
  schema: JSONSchema;
  tooltipEnabled?: boolean;
};

const getHandleTooltipContent = (schema: JSONSchema): React.ReactElement => {
  const typeStr = jsonSchemaToTypeString(schema);
  if (typeStr.split('\n').length > 1) {
    return (
      <div>
        <strong>Type:</strong>
        <pre className="text-xs">
          <code>{typeStr}</code>
        </pre>
      </div>
    );
  }
  return (
    <p>
      <strong>Type:</strong> {typeStr}
    </p>
  );
};

const MergeHandle = ({
  handleId,
  label,
  type,
  schema,
  tooltipEnabled = true,
}: MergeHandleProps) => {
  const updateNodeInternals = useUpdateNodeInternals();
  const nodeId = useNodeId();

  useEffect(() => {
    if (nodeId !== null) {
      updateNodeInternals(nodeId);
    }
  }, [nodeId, updateNodeInternals, handleId]);

  return (
    <LabeledHandle
      id={handleId}
      labelClassName="text-xs"
      position={type === 'input' ? Position.Left : Position.Right}
      title={label}
      tooltipContent={getHandleTooltipContent(schema)}
      tooltipEnabled={tooltipEnabled}
      type={type === 'input' ? 'target' : 'source'}
    />
  );
};

type NormalizedMergeInput = MergeInputDefinition & { label: string };

const normalizeInputs = (inputs: MergeInputDefinition[]): NormalizedMergeInput[] => {
  return inputs.map((entry, index) => ({
    ...entry,
    label: entry.label ?? `Input ${index + 1}`,
  }));
};

const MergeNode = () => {
  const nodeId = useNodeId();
  const { setNodes, setEdges } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const {
    nodeRuntime,
    flow: { nodes, edges },
    isReadOnly,
  } = useFlow();

  const nodeData = useMemo(() => {
    if (nodeId === null) {
      return null;
    }
    return nodes.find((node) => node.id === nodeId) ?? null;
  }, [nodeId, nodes]);

  const configuration = getNodeConfiguration(nodeData);
  const nodeType = nodeData?.type;
  const title = nodeType !== undefined && nodeType !== '' ? createDisplayName(nodeType) : 'Merge';

  const rawInputs = getMergeInputsFromConfig(configuration);
  const inputs = normalizeInputs(rawInputs);

  const updateConfiguration = useCallback(
    (updater: (config: Record<string, unknown>) => Record<string, unknown>) => {
      if (nodeId === null) {
        return;
      }
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          if (node.id !== nodeId) {
            return node;
          }
          const nextConfig = updater(getNodeConfiguration(node));
          return {
            ...node,
            data: {
              ...node.data,
              configuration: nextConfig,
            },
          };
        }),
      );
    },
    [nodeId, setNodes],
  );

  const addInput = useCallback(() => {
    updateConfiguration((config) => {
      const existing = getMergeInputsFromConfig(config);
      const nextIndex = existing.length + 1;
      return {
        ...config,
        [MERGE_INPUTS_KEY]: [
          ...existing,
          {
            id: crypto.randomUUID(),
            label: `Input ${nextIndex}`,
          },
        ],
      };
    });
  }, [updateConfiguration]);

  const removeInput = useCallback(
    (inputId: string) => {
      if (inputs.length <= 1) {
        return;
      }
      updateConfiguration((config) => {
        const existing = getMergeInputsFromConfig(config);
        return {
          ...config,
          [MERGE_INPUTS_KEY]: existing.filter((entry) => entry.id !== inputId),
        };
      });
      if (nodeId !== null) {
        setEdges((currentEdges) =>
          currentEdges.filter((edge) => {
            if (edge.target !== nodeId) {
              return true;
            }
            if (edge.targetHandle === null || edge.targetHandle === undefined) {
              return true;
            }
            return !edge.targetHandle.startsWith(`${inputId}${MERGE_HANDLE_SEPARATOR}`);
          }),
        );
      }
    },
    [inputs.length, nodeId, setEdges, updateConfiguration],
  );

  useEffect(() => {
    if (nodeId === null) {
      return;
    }
    if (!isReadOnly && inputs.length === 0) {
      addInput();
    }
  }, [addInput, inputs.length, isReadOnly, nodeId]);

  const { resolvedNodeSchema } = useNodeSchemaData({
    id: nodeId,
    nodeRuntime,
    nodes,
    edges,
  });

  const outputEntries = useMemo(() => {
    const properties = resolvedNodeSchema?.output.properties ?? {};
    return Object.entries(properties) as Array<[string, JSONSchema]>;
  }, [resolvedNodeSchema?.output.properties]);

  useEffect(() => {
    if (nodeId !== null) {
      updateNodeInternals(nodeId);
    }
  }, [nodeId, updateNodeInternals, inputs.length, outputEntries.length]);

  return (
    <SchemaNodeShell className="w-72" title={title}>
      <div className="flex items-center justify-between px-3 pb-2">
        <div className="text-muted-foreground text-xs font-semibold">Inputs</div>
        <Button
          className="h-7 px-2 text-xs"
          disabled={isReadOnly}
          size="sm"
          type="button"
          variant="outline"
          onClick={addInput}
        >
          <Plus className="mr-1 h-3 w-3" />
          Add Input
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 px-3 pb-3">
        <div className="flex flex-col items-start gap-3">
          {inputs.map((input) => (
            <div key={input.id} className="w-full overflow-hidden rounded border">
              <div className="flex items-center justify-between border-b px-2 py-1">
                <span className="text-xs font-semibold">{input.label}</span>
                <Button
                  className="h-6 w-6"
                  disabled={isReadOnly || inputs.length <= 1}
                  size="sm"
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    removeInput(input.id);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
              <div className={cn('flex flex-col gap-2 py-2', outputEntries.length === 0 && 'px-2')}>
                {outputEntries.length === 0 ? (
                  <div className="text-muted-foreground text-xs">
                    Configure outputs to add handles.
                  </div>
                ) : (
                  outputEntries.map(([propName, propSchema]) => (
                    <MergeHandle
                      key={`${input.id}-${propName}`}
                      handleId={buildMergeHandleId(input.id, propName)}
                      label={createDisplayName(propName)}
                      schema={propSchema}
                      tooltipEnabled={!isReadOnly}
                      type="input"
                    />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col items-end gap-4">
          {outputEntries.length === 0 ? (
            <div className="text-muted-foreground text-xs">No outputs</div>
          ) : (
            outputEntries.map(([propName, propSchema]) => (
              <MergeHandle
                key={`output-${propName}`}
                handleId={propName}
                label={createDisplayName(propName)}
                schema={propSchema}
                tooltipEnabled={!isReadOnly}
                type="output"
              />
            ))
          )}
        </div>
      </div>
    </SchemaNodeShell>
  );
};

export default MergeNode;
