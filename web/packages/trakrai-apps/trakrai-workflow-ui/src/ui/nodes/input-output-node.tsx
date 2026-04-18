import { useMemo } from 'react';

import {
  toObjectSchema,
  type NodeEvent,
  type NodeSchema,
  type ResolvedNodeEventSchema,
} from '@trakrai-workflow/core';
import { buildNodeEventId, createDisplayName } from '@trakrai-workflow/core/utils';
import { Position, useNodeId } from '@xyflow/react';
import { z } from 'zod';

import { getOutputTooltipContent } from './display-type';
import { InputHandlesRenderer, OutputHandlesRenderer } from './handles-renderer';
import { LabeledHandle } from './labeled-handle';
import { SchemaNodeShell } from './schema-node-shell';

import { useFlow } from '../flow-context';
import { useNodeSchemaData } from '../sidebar/use-node-schema';

type JSONSchema = z.core.JSONSchema.JSONSchema;

const EventOutputHandle = ({
  propName,
  eventName,
  ...rest
}: {
  propName: string;
  eventName: string;
  tooltipContent?: React.ReactNode;
  tooltipEnabled?: boolean;
}) => {
  const readableTitle = useMemo(() => createDisplayName(propName), [propName]);
  return (
    <LabeledHandle
      key={propName}
      id={buildNodeEventId(eventName, propName)}
      labelClassName="text-xs"
      position={Position.Right}
      title={readableTitle}
      type="source"
      {...rest}
    />
  );
};

const NodeEventRenderer = ({
  eventName,
  eventSchema,
  selectedRunId,
}: {
  eventName: string;
  eventSchema: NodeEvent | ResolvedNodeEventSchema;
  selectedRunId?: string;
}) => {
  const readableEventName = useMemo(() => createDisplayName(eventName), [eventName]);
  const outputJson = useMemo(() => toObjectSchema(eventSchema.data), [eventSchema]);
  return (
    <div key={eventName} className="flex flex-col gap-4 border-t py-2">
      <p className="text-center text-sm font-semibold">{readableEventName}</p>
      <div className="flex flex-col items-end justify-center gap-4">
        {Object.entries(outputJson.properties).map(([propName]) => {
          const propSchema = outputJson.properties[propName] as JSONSchema | undefined;

          return (
            <EventOutputHandle
              key={propName}
              eventName={eventName}
              propName={propName}
              tooltipContent={getOutputTooltipContent(propSchema)}
              tooltipEnabled={selectedRunId === undefined}
            />
          );
        })}
      </div>
    </div>
  );
};

/**
 * Default node renderer showing input handles, output handles, and event outputs.
 *
 * Used as the fallback renderer when a node type has no custom handler renderer.
 * Resolves the node schema at runtime to display typed input/output handles.
 */
const InputOutputNode = ({ nodeSchema, title }: { nodeSchema?: NodeSchema; title: string }) => {
  const {
    selectedRunId,
    nodeRuntime,
    flow: { nodes, edges },
  } = useFlow();
  const nodeId = useNodeId();
  const currentNode = useMemo(() => nodes.find((node) => node.id === nodeId), [nodeId, nodes]);
  const { allInputs, inputsViaConfiguration, resolvedNodeSchema, config } = useNodeSchemaData({
    id: nodeId,
    edges,
    nodeRuntime,
    nodes,
  });
  const inputJson = useMemo(() => {
    if (resolvedNodeSchema !== undefined) {
      return resolvedNodeSchema.input;
    }
    return nodeSchema !== undefined
      ? (z.toJSONSchema(nodeSchema.input) as JSONSchema)
      : ({
          type: 'object',
          properties: {},
        } as JSONSchema);
  }, [nodeSchema, resolvedNodeSchema]);

  const outputJson = useMemo(() => {
    if (resolvedNodeSchema !== undefined) {
      return resolvedNodeSchema.output;
    }
    return nodeSchema !== undefined
      ? (z.toJSONSchema(nodeSchema.output) as JSONSchema)
      : ({
          type: 'object',
          properties: {},
        } as JSONSchema);
  }, [nodeSchema, resolvedNodeSchema]);

  const events = resolvedNodeSchema?.events ?? nodeSchema?.events;
  const eventEntries = useMemo(
    () => Object.entries(events ?? {}) as Array<[string, NodeEvent | ResolvedNodeEventSchema]>,
    [events],
  );

  return (
    <SchemaNodeShell
      className="w-56"
      title={
        typeof currentNode?.data.title === 'string' && currentNode.data.title.length > 0
          ? currentNode.data.title
          : title
      }
    >
      <div className="grid grid-cols-2 gap-2 py-2">
        <InputHandlesRenderer
          allInputs={allInputs}
          config={config}
          inputJson={inputJson}
          inputsViaConfiguration={inputsViaConfiguration}
          tooltipEnabled={selectedRunId === undefined}
        />
        <OutputHandlesRenderer
          outputJson={outputJson}
          tooltipEnabled={selectedRunId === undefined}
        />
      </div>
      {eventEntries.length > 0
        ? eventEntries.map(([eventName, eventSchema]) => (
            <NodeEventRenderer
              key={eventName}
              eventName={eventName}
              eventSchema={eventSchema}
              selectedRunId={selectedRunId}
            />
          ))
        : null}
    </SchemaNodeShell>
  );
};

export default InputOutputNode;
