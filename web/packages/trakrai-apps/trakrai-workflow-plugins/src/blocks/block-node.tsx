import { memo, useEffect, useMemo } from 'react';

import { Badge } from '@trakrai/design-system/components/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@trakrai/design-system/components/tooltip';
import { cn } from '@trakrai/design-system/lib/utils';
import {
  SchemaNodeShell,
  getInputTooltipContent,
  getOutputTooltipContent,
  useFlow,
} from '@trakrai-workflow/ui';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';

import {
  buildBlockHandleId,
  getBlockDisplayData,
  type FluxeryBlockConfigField,
  type FluxeryBlockPort,
} from './block-utils';

const BLOCK_HANDLE_LABEL_MAX_LENGTH = 28;
const EMPTY_CONFIG_FIELDS: FluxeryBlockConfigField[] = [];
const EMPTY_PORTS: FluxeryBlockPort[] = [];
const EMPTY_PORT_IDS: string[] = [];

const truncateHandleLabel = (label: string, maxLength = 22) =>
  label.length > maxLength ? `${label.slice(0, Math.max(0, maxLength - 1))}…` : label;

const blockHandleClassName =
  'dark:border-muted-foreground dark:bg-secondary h-[11px] w-[11px] rounded-full border border-slate-300 bg-slate-100 transition';

const BlockHandleRow = ({
  handleId,
  label,
  position,
  connectable,
  tooltipContent,
  tooltipEnabled,
}: {
  handleId: string;
  label: string;
  position: Position.Left | Position.Right;
  connectable: boolean;
  tooltipContent: React.ReactNode;
  tooltipEnabled: boolean;
}) => {
  const isInput = position === Position.Left;
  const labelNode = (
    <p
      className={cn(
        'text-foreground block min-w-0 truncate px-3 text-xs leading-none',
        isInput ? 'text-left' : 'text-right',
      )}
      title={label}
    >
      {truncateHandleLabel(label, BLOCK_HANDLE_LABEL_MAX_LENGTH)}
    </p>
  );

  return (
    <div
      className={cn(
        'relative flex min-h-4 w-full min-w-0 items-center',
        isInput ? 'pr-1 pl-5' : 'pr-5 pl-1',
      )}
    >
      {connectable ? (
        <Handle
          className={cn(blockHandleClassName, '!top-[calc(50%+1px)] !m-0 -translate-y-1/2')}
          id={handleId}
          position={position}
          type={isInput ? 'target' : 'source'}
        />
      ) : null}
      {tooltipEnabled ? (
        <Tooltip>
          <TooltipTrigger asChild>{labelNode}</TooltipTrigger>
          <TooltipContent>{tooltipContent}</TooltipContent>
        </Tooltip>
      ) : (
        labelNode
      )}
    </div>
  );
};

const BlockHandleList = ({
  ports,
  configuredPortIds,
  position,
  configuredValueByPortId,
  schemaByPortId,
  tooltipEnabled,
  className,
}: {
  ports: FluxeryBlockPort[];
  configuredPortIds?: Set<string>;
  position: Position.Left | Position.Right;
  configuredValueByPortId?: Map<string, unknown>;
  schemaByPortId?: Map<string, unknown>;
  tooltipEnabled: boolean;
  className?: string;
}) => {
  const isInput = position === Position.Left;

  return (
    <div
      className={cn(
        'flex w-full min-w-0 flex-col justify-center gap-4',
        isInput ? 'items-start' : 'items-end',
        className,
      )}
    >
      {ports.map((port) => (
        <BlockHandleRow
          key={port.portId}
          connectable={!isInput || configuredPortIds?.has(port.portId) !== true}
          handleId={buildBlockHandleId(port.direction, port.nodeId, port.handle)}
          label={port.label}
          position={position}
          tooltipContent={
            <div className="space-y-1">
              <p className="font-medium">{port.label}</p>
              {isInput
                ? getInputTooltipContent(
                    schemaByPortId?.get(port.portId) as Parameters<
                      typeof getInputTooltipContent
                    >[0],
                    configuredValueByPortId?.get(port.portId),
                    configuredPortIds?.has(port.portId) === true,
                  )
                : getOutputTooltipContent(
                    schemaByPortId?.get(port.portId) as Parameters<
                      typeof getOutputTooltipContent
                    >[0],
                  )}
            </div>
          }
          tooltipEnabled={tooltipEnabled}
        />
      ))}
    </div>
  );
};

const BlockConfigHandles = ({
  configFields,
  configuredPortIds,
  configuredValueByPortId,
  schemaByPortId,
  tooltipEnabled,
}: {
  configFields: FluxeryBlockConfigField[];
  configuredPortIds: Set<string>;
  configuredValueByPortId: Map<string, unknown>;
  schemaByPortId: Map<string, unknown>;
  tooltipEnabled: boolean;
}) => {
  if (configFields.length === 0) {
    return null;
  }

  return (
    <div className="bg-muted/30 border-t py-2">
      <p className="text-muted-foreground px-3 text-[11px] tracking-wide uppercase">Config</p>
      <div className="mt-2 flex flex-col items-start gap-4">
        {configFields.map((field) => (
          <BlockHandleRow
            key={field.portId}
            connectable={!configuredPortIds.has(field.portId)}
            handleId={buildBlockHandleId('input', field.nodeId, field.key)}
            label={field.label}
            position={Position.Left}
            tooltipContent={
              <div className="space-y-1">
                <p className="font-medium">{field.label}</p>
                {getInputTooltipContent(
                  schemaByPortId.get(field.portId) as Parameters<typeof getInputTooltipContent>[0],
                  configuredValueByPortId.get(field.portId),
                  configuredPortIds.has(field.portId),
                )}
              </div>
            }
            tooltipEnabled={tooltipEnabled}
          />
        ))}
      </div>
    </div>
  );
};

const BlockNodeComponent = memo((props: NodeProps) => {
  const displayData = getBlockDisplayData({ data: props.data, type: props.type });
  const updateNodeInternals = useUpdateNodeInternals();
  const { nodeRuntime, selectedRunId, workflow } = useFlow();
  const blockInputs = displayData?.inputs ?? EMPTY_PORTS;
  const blockOutputs = displayData?.outputs ?? EMPTY_PORTS;
  const blockConfigFields = displayData?.configFields ?? EMPTY_CONFIG_FIELDS;
  const configuredPortIds = new Set(displayData?.configuredTargetPortIds ?? EMPTY_PORT_IDS);
  const tooltipEnabled = selectedRunId === undefined;
  const hasInputs = blockInputs.length > 0;
  const hasOutputs = blockOutputs.length > 0;

  const configuredValueByPortId = useMemo(() => {
    const values = new Map<string, unknown>();
    const allTargetEntries = [
      ...blockInputs.map((port) => ({
        nodeId: port.nodeId,
        key: port.handle,
        portId: port.portId,
      })),
      ...blockConfigFields.map((field) => ({
        nodeId: field.nodeId,
        key: field.key,
        portId: field.portId,
      })),
    ];

    for (const entry of allTargetEntries) {
      const node = workflow.nodes.find((currentNode) => currentNode.id === entry.nodeId);
      const configuration = node?.data.configuration;
      if (
        configuration !== null &&
        configuration !== undefined &&
        !Array.isArray(configuration) &&
        typeof configuration === 'object'
      ) {
        values.set(entry.portId, configuration[entry.key]);
      }
    }

    return values;
  }, [blockConfigFields, blockInputs, workflow.nodes]);

  const inputSchemaByPortId = useMemo(() => {
    const schemas = new Map<string, unknown>();
    for (const port of blockInputs) {
      schemas.set(
        port.portId,
        nodeRuntime.resolveNodeSchemaById(port.nodeId)?.input.properties[port.handle],
      );
    }
    for (const field of blockConfigFields) {
      schemas.set(
        field.portId,
        nodeRuntime.resolveNodeSchemaById(field.nodeId)?.input.properties[field.key],
      );
    }
    return schemas;
  }, [blockConfigFields, blockInputs, nodeRuntime]);

  const outputSchemaByPortId = useMemo(() => {
    const schemas = new Map<string, unknown>();
    for (const port of blockOutputs) {
      schemas.set(
        port.portId,
        nodeRuntime.resolveNodeSchemaById(port.nodeId)?.output.properties[port.handle],
      );
    }
    return schemas;
  }, [blockOutputs, nodeRuntime]);

  useEffect(() => {
    if (displayData !== null) {
      updateNodeInternals(props.id);
    }
  }, [displayData, props.id, updateNodeInternals]);

  if (displayData === null) {
    return null;
  }

  return (
    <SchemaNodeShell
      className="w-72"
      contentClassName="py-0"
      showTriggerHandle={false}
      title={displayData.title}
    >
      <div className="flex items-center justify-between border-b px-3 py-2 text-xs">
        <span className="text-muted-foreground">Reusable block</span>
        <Badge className="rounded-none" variant="outline">
          {displayData.nodeCount} nodes
        </Badge>
      </div>
      <div className={cn('py-2', hasInputs && hasOutputs ? 'grid grid-cols-2 gap-2' : 'flex')}>
        {hasInputs ? (
          <BlockHandleList
            className={hasOutputs ? undefined : 'pr-2'}
            configuredPortIds={configuredPortIds}
            configuredValueByPortId={configuredValueByPortId}
            ports={displayData.inputs}
            position={Position.Left}
            schemaByPortId={inputSchemaByPortId}
            tooltipEnabled={tooltipEnabled}
          />
        ) : null}
        {hasOutputs ? (
          <BlockHandleList
            className={hasInputs ? undefined : 'pl-2'}
            ports={displayData.outputs}
            position={Position.Right}
            schemaByPortId={outputSchemaByPortId}
            tooltipEnabled={tooltipEnabled}
          />
        ) : null}
      </div>
      <BlockConfigHandles
        configFields={displayData.configFields}
        configuredPortIds={configuredPortIds}
        configuredValueByPortId={configuredValueByPortId}
        schemaByPortId={inputSchemaByPortId}
        tooltipEnabled={tooltipEnabled}
      />
    </SchemaNodeShell>
  );
});

BlockNodeComponent.displayName = 'FluxeryBlockNode';

export default BlockNodeComponent;
