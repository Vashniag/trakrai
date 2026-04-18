import { useMemo } from 'react';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@trakrai/design-system/components/select';
import { getSchemaProperty } from '@trakrai-workflow/core';
import {
  createDisplayName,
  isEventHandle,
  isExecutionSuccessHandle,
} from '@trakrai-workflow/core/utils';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';

import { useFlow } from '../flow-context';

const HumanizedString = ({ value }: { value: string }) => {
  const humanized = useMemo(() => createDisplayName(value), [value]);
  return <span>{humanized}</span>;
};

const ConditionalInput = ({
  source,
  sourceHandleId,
  data,
  id,
}: Pick<EdgeProps, 'source' | 'sourceHandleId' | 'data' | 'id'>) => {
  const {
    flow: { nodes, onEdgesChange, edges },
    nodeRuntime,
  } = useFlow();
  const sourceNode = useMemo(() => nodes.find((node) => node.id === source), [nodes, source]);
  const edge = useMemo(() => edges.find((edge) => edge.id === id), [edges, id]);
  const edgeOptions = useMemo(() => {
    if (sourceHandleId === undefined || sourceHandleId === null) {
      return [];
    }
    if (isExecutionSuccessHandle(sourceHandleId)) {
      return [true, false];
    }
    if (sourceNode === undefined) {
      return [];
    }
    const sourceNodeSchema = nodeRuntime.resolveNodeSchema(sourceNode);
    if (sourceNodeSchema === undefined) {
      return [];
    }
    const event = isEventHandle(sourceHandleId);
    const outputSchema = event.isEvent
      ? sourceNodeSchema.events?.[event.eventName as string]?.data
      : sourceNodeSchema.output;
    if (outputSchema === undefined) {
      return [];
    }
    const sourceHandle = event.isEvent ? (event.eventHandle as string | undefined) : sourceHandleId;
    if (sourceHandle === undefined) {
      return [];
    }
    const property = getSchemaProperty(outputSchema, sourceHandle);
    if (property === undefined || typeof property !== 'object' || Array.isArray(property)) {
      return [];
    }
    const propertySchema = property as Record<string, unknown>;
    if (propertySchema.type === 'boolean') {
      return [true, false];
    }
    if (propertySchema.type === 'string' && Array.isArray(propertySchema.enum)) {
      return propertySchema.enum.filter((v): v is string => typeof v === 'string');
    }
    return [];
  }, [sourceNode, sourceHandleId, nodeRuntime]);

  if (edge === undefined || edgeOptions.length === 0 || onEdgesChange === undefined) {
    return null;
  }

  return (
    <Select
      value={data?.configuration === undefined ? undefined : JSON.stringify(data.configuration)}
      onValueChange={(value) => {
        const parsed = JSON.parse(value) as unknown as string | boolean | number;
        onEdgesChange([
          {
            type: 'replace',
            id: id,
            item: {
              ...edge,
              data: {
                ...edge.data,
                configuration: parsed,
              },
            },
          },
        ]);
      }}
    >
      <SelectTrigger className="bg-background dark:bg-background dark:hover:bg-background hover:bg-background w-[96px]">
        <SelectValue placeholder="Select" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {edgeOptions.map((option) => (
            <SelectItem key={option.toString()} value={JSON.stringify(option)}>
              <HumanizedString value={option.toString()} />
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
};

/**
 * Custom edge renderer for conditional connections.
 *
 * Renders a bezier edge with an inline dropdown selector for boolean or enum
 * output values. Updates the edge data when the selection changes.
 */
export const ConditionalEdge = (props: EdgeProps) => {
  const {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style = {},
    markerEnd,
  } = props;
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge markerEnd={markerEnd} path={edgePath} style={style} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute z-6"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
          }}
        >
          <ConditionalInput {...props} />
        </div>
      </EdgeLabelRenderer>
    </>
  );
};
