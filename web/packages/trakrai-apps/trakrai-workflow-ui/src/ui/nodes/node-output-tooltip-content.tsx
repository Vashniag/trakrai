import { useQuery } from '@tanstack/react-query';
import { TooltipContent } from '@trakrai/design-system/components/tooltip';
import { NodeRunStatus, type NodeRunDetails } from '@trakrai-workflow/core';
import { useNodeId } from '@xyflow/react';

/**
 * Tooltip content that fetches and displays node run details (status, output, errors, timing).
 *
 * Used inside `SchemaNodeShell` to show run information when hovering a node
 * while a workflow run is selected. Data is fetched on demand via React Query.
 */
const NodeOutputTooltipContent = ({
  tooltipDisplayed,
  selectedRunId,
  getNodeRunTooltipDetails,
}: {
  tooltipDisplayed?: boolean;
  selectedRunId?: string;
  getNodeRunTooltipDetails?: (nodeId: string) => Promise<NodeRunDetails>;
}) => {
  const nodeId = useNodeId();

  const { data: outputData } = useQuery({
    queryKey: ['nodeRunDetails', selectedRunId, nodeId],
    queryFn: () => getNodeRunTooltipDetails?.(nodeId ?? ''),
    enabled:
      tooltipDisplayed === true &&
      selectedRunId !== undefined &&
      nodeId !== null &&
      getNodeRunTooltipDetails !== undefined,
  });

  if (outputData === undefined) {
    return null;
  }

  const {
    nodeStatus,
    output: parsedOutput,
    failureReason,
    attempts,
    failingErrorMessage,
    failureErrorStack,
    queuedAt,
    startedAt,
    endedAt,
  } = outputData;

  const errorMessage = failingErrorMessage ?? failureReason;
  const showError =
    nodeStatus === NodeRunStatus.Retrying ||
    nodeStatus === NodeRunStatus.Failing ||
    nodeStatus === NodeRunStatus.Failed;

  return (
    <TooltipContent className="max-h-96 max-w-md overflow-clip">
      <div className="max-h-[inherit] space-y-2 overflow-y-auto text-sm">
        <div>
          <span className="font-semibold">Status: </span>
          <span>{nodeStatus}</span>
        </div>

        {nodeStatus === NodeRunStatus.Waiting && (
          <div className="italic">No data available yet</div>
        )}

        {nodeStatus === NodeRunStatus.Running && (
          <div className="italic">Execution in progress...</div>
        )}

        {showError === true && attempts !== null && (
          <div>
            <span className="font-semibold">Attempts: </span>
            <span>{attempts}</span>
          </div>
        )}

        {showError && errorMessage !== undefined ? (
          <div className="space-y-1">
            <div className="font-semibold">Error:</div>
            <pre className="overflow-x-auto rounded p-2 text-xs break-words whitespace-pre-wrap">
              {errorMessage}
            </pre>
            {failureErrorStack !== null &&
              failureErrorStack !== undefined &&
              failureErrorStack !== '' && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs">Stack trace</summary>
                  <pre className="mt-1 overflow-x-auto rounded p-2 text-xs break-words whitespace-pre-wrap">
                    {failureErrorStack}
                  </pre>
                </details>
              )}
          </div>
        ) : null}

        {nodeStatus === NodeRunStatus.Completed && parsedOutput !== null && (
          <div className="space-y-1">
            <div className="font-semibold">Output:</div>
            <pre className="overflow-x-auto rounded p-2 text-xs break-words whitespace-pre-wrap">
              {JSON.stringify(parsedOutput, null, 2)}
            </pre>
          </div>
        )}

        {(queuedAt !== null || startedAt !== null || endedAt !== null) && (
          <div className="mt-2 space-y-1 border-t pt-2 text-xs">
            {queuedAt !== null && queuedAt !== undefined && (
              <div>
                <span className="font-semibold">Queued: </span>
                {queuedAt.toLocaleString()}
              </div>
            )}
            {startedAt !== null && startedAt !== undefined && (
              <div>
                <span className="font-semibold">Started: </span>
                {startedAt.toLocaleString()}
              </div>
            )}
            {endedAt !== null && endedAt !== undefined && (
              <div>
                <span className="font-semibold">Ended: </span>
                {endedAt.toLocaleString()}
              </div>
            )}
          </div>
        )}
      </div>
    </TooltipContent>
  );
};

export default NodeOutputTooltipContent;
