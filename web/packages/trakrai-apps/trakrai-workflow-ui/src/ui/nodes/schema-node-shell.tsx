import { useMemo, useState } from 'react';

import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
} from '@trakrai/design-system/components/tooltip';
import { cn } from '@trakrai/design-system/lib/utils';
import { ExecutionSuccessHandle, NodeRunStatus } from '@trakrai-workflow/core';
import { Position, useNodeId } from '@xyflow/react';

import { BaseHandle } from './base-handle';
import { BaseNode, BaseNodeContent, BaseNodeHeader, BaseNodeHeaderTitle } from './base-node';
import NodeOutputTooltipContent from './node-output-tooltip-content';

import { useFlow } from '../flow-context';

/**
 * Standard node wrapper that displays a titled card with status-colored borders.
 *
 * Renders a node shell with a header (including trigger/success handles), content area,
 * and a tooltip showing run details when a workflow run is selected. Border color
 * changes based on `NodeRunStatus` (green for completed, red for failed, etc.).
 * The shell expects to run inside both `FluxeryProvider` and a React Flow node render,
 * because it reads run presentation state from `useFlow()` and the current node id
 * from `useNodeId()`.
 *
 * @param title - The display title rendered in the node header.
 * @param className - Additional CSS classes applied to the node container.
 * @param showTriggerHandle - Whether to show the trigger (target) handle on the left.
 * Defaults to `true`. Disable this for nodes that should not accept trigger-style
 * control-flow edges.
 * @param children - Content rendered inside the node body.
 *
 * @example
 * ```tsx
 * <SchemaNodeShell title="Send Email">
 *   <InputHandlesRenderer ... />
 *   <OutputHandlesRenderer ... />
 * </SchemaNodeShell>
 * ```
 */
export const SchemaNodeShell = ({
  title,
  className,
  contentClassName,
  showTriggerHandle = true,
  children,
}: {
  title: string;
  className?: string;
  contentClassName?: string;
  showTriggerHandle?: boolean;
  children: React.ReactNode;
}) => {
  const { selectedRunId, nodeRunStatuses, getNodeRunTooltipDetails } = useFlow();
  const nodeId = useNodeId();

  const nodeStatus = useMemo(() => {
    if (nodeId === null) {
      return NodeRunStatus.Waiting;
    }
    return nodeRunStatuses[nodeId] ?? NodeRunStatus.Waiting;
  }, [nodeId, nodeRunStatuses]);

  const borderClass = useMemo(() => {
    switch (nodeStatus) {
      case NodeRunStatus.Completed:
        return 'border-green-500';
      case NodeRunStatus.Failed:
        return 'border-red-500';
      case NodeRunStatus.Retrying:
        return 'border-yellow-500 animate-pulse';
      case NodeRunStatus.Running:
        return 'border-blue-500 animate-pulse';
      case NodeRunStatus.Failing:
        return 'border-yellow-500';
      case NodeRunStatus.Waiting:
      default:
        return 'border-gray-300';
    }
  }, [nodeStatus]);

  const [tooltipDisplayed, setTooltipDisplayed] = useState(false);

  return (
    <TooltipProvider>
      <Tooltip
        open={tooltipDisplayed}
        onOpenChange={(open) => {
          // Run-detail tooltips are only meaningful while a workflow run is selected.
          if (selectedRunId === undefined && open) {
            return;
          }
          setTooltipDisplayed(open);
        }}
      >
        <TooltipTrigger asChild>
          <BaseNode className={cn('w-56', borderClass, className)}>
            <BaseNodeHeader className="relative border-b">
              {showTriggerHandle ? (
                <BaseHandle
                  className="rounded-none"
                  id="trigger"
                  position={Position.Left}
                  type="target"
                />
              ) : null}
              <BaseHandle
                className="rounded-none"
                id={ExecutionSuccessHandle}
                position={Position.Right}
                title="True when the node succeeds. False when it fails."
                type="source"
              />
              <BaseNodeHeaderTitle className="text-center">{title}</BaseNodeHeaderTitle>
            </BaseNodeHeader>
            <BaseNodeContent className={cn('w-full px-0 py-2', contentClassName)}>
              {children}
            </BaseNodeContent>
          </BaseNode>
        </TooltipTrigger>
        <NodeOutputTooltipContent
          getNodeRunTooltipDetails={getNodeRunTooltipDetails}
          selectedRunId={selectedRunId}
          tooltipDisplayed={tooltipDisplayed}
        />
      </Tooltip>
    </TooltipProvider>
  );
};
