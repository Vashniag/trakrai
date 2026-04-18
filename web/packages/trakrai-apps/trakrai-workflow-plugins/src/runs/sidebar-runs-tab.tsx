import { useCallback, useEffect, useMemo } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@trakrai/design-system/components/badge';
import { ScrollArea } from '@trakrai/design-system/components/scroll-area';
import {
  createFluxerySidebarTab,
  type FluxerySidebarTabComponent,
  useFlow,
  useSidebarTabAutoSelect,
  useTRPCPluginAPIs,
} from '@trakrai-workflow/ui';
import { format } from 'date-fns';

import { FunctionRunStatus } from './inngest-graphql/graphql';
import { getNodeRunStatus } from './inngest-graphql/helpers';
import {
  getRunStatusVariant,
  getWorkflowDataOutputId,
  hasRunningOrQueuedRuns,
  parseWorkflowData,
  RUN_POLL_INTERVAL,
  RUNS_DATE_FORMAT,
  RUNS_POLL_INTERVAL,
  RUNS_POLL_INTERVAL_LONG,
} from './sidebar-runs-tab-utils';

import type { RunsPlugin } from './runs-router';
import type { WorkflowData, WorkflowRun } from '@trakrai-workflow/core';

type SidebarRunsTabProps = {
  celQuery: string;
  selectedRunId?: string;
  runPollingEnabled?: boolean;
  setRunId: (runId: string | undefined) => void;
};

type RunsDataConfig = {
  trpc: ReturnType<typeof useTRPCPluginAPIs<RunsPlugin>>['client'];
  displayedNodeIds: string[];
  selectedRunId?: string;
  setDummyWorkflowData: React.Dispatch<React.SetStateAction<WorkflowData | undefined>>;
  setUseDummyWorkflow: React.Dispatch<React.SetStateAction<boolean>>;
  setNodeRunPresentation: ReturnType<typeof useFlow>['setNodeRunPresentation'];
  clearNodeRunPresentation: ReturnType<typeof useFlow>['clearNodeRunPresentation'];
};

const useWorkflowRuns = ({
  trpc,
  celQuery,
  runPollingEnabled,
}: {
  trpc: ReturnType<typeof useTRPCPluginAPIs<RunsPlugin>>['client'];
  celQuery: string;
  runPollingEnabled?: boolean;
}) => {
  const { data: workflowRuns } = useQuery(
    trpc.getRuns.queryOptions(
      {
        startTime: new Date(0),
        celQuery,
      },
      {
        refetchInterval: (data): number | false => {
          const hasRunningRun = hasRunningOrQueuedRuns(data.state.data);
          if (hasRunningRun) {
            return RUNS_POLL_INTERVAL;
          }
          if (runPollingEnabled === true) {
            return RUNS_POLL_INTERVAL_LONG;
          }
          return false;
        },
      },
    ),
  );
  return workflowRuns ?? [];
};

const useRunsData = ({
  trpc,
  displayedNodeIds,
  selectedRunId,
  setDummyWorkflowData,
  setUseDummyWorkflow,
  setNodeRunPresentation,
  clearNodeRunPresentation,
}: RunsDataConfig) => {
  const queryClient = useQueryClient();
  const { data: runData } = useQuery(
    trpc.getRunDetails.queryOptions(
      { runId: selectedRunId ?? '' },
      {
        enabled: selectedRunId !== undefined,
        refetchInterval: (data) =>
          data.state.data?.status === FunctionRunStatus.Running ||
          data.state.data?.status === FunctionRunStatus.Queued
            ? RUN_POLL_INTERVAL
            : false,
      },
    ),
  );

  const workflowDataOutputId = useMemo(() => getWorkflowDataOutputId(runData), [runData]);

  const { data: rawWorkflowData } = useQuery(
    trpc.getTraceResult.queryOptions(
      { outputId: workflowDataOutputId ?? '' },
      {
        enabled: workflowDataOutputId !== null,
        refetchInterval: (data) => (data.state.data === '' ? RUN_POLL_INTERVAL : false),
      },
    ),
  );

  const parsedWorkflowData = useMemo(() => parseWorkflowData(rawWorkflowData), [rawWorkflowData]);

  const nodeStatuses = useMemo(() => {
    if (selectedRunId === undefined || runData === undefined) {
      return {};
    }
    return Object.fromEntries(
      displayedNodeIds.map((nodeId) => [nodeId, getNodeRunStatus(runData, nodeId).nodeStatus]),
    );
  }, [displayedNodeIds, runData, selectedRunId]);

  const getNodeRunTooltipDetails = useCallback(
    (nodeId: string) => {
      if (selectedRunId === undefined) {
        throw new Error('No selected run id available for node run details');
      }
      return queryClient.fetchQuery(
        trpc.getNodeRunDetails.queryOptions({ runId: selectedRunId, nodeId }),
      );
    },
    [queryClient, selectedRunId, trpc],
  );

  const selectedRunTooltipResolver = useMemo(() => {
    if (selectedRunId === undefined) {
      return undefined;
    }
    return getNodeRunTooltipDetails;
  }, [getNodeRunTooltipDetails, selectedRunId]);

  useEffect(() => {
    if (selectedRunId === undefined) {
      clearNodeRunPresentation();
      setDummyWorkflowData(undefined);
      setUseDummyWorkflow(false);
      return;
    }
    setNodeRunPresentation({
      selectedRunId,
      nodeStatuses: {},
      getNodeRunTooltipDetails: selectedRunTooltipResolver,
    });
    setDummyWorkflowData(undefined);
    setUseDummyWorkflow(false);
  }, [
    clearNodeRunPresentation,
    selectedRunTooltipResolver,
    selectedRunId,
    setDummyWorkflowData,
    setNodeRunPresentation,
    setUseDummyWorkflow,
  ]);

  useEffect(() => {
    if (selectedRunId === undefined) {
      return;
    }
    setNodeRunPresentation({
      selectedRunId,
      nodeStatuses,
      getNodeRunTooltipDetails: selectedRunTooltipResolver,
    });
  }, [nodeStatuses, selectedRunId, selectedRunTooltipResolver, setNodeRunPresentation]);

  useEffect(() => {
    if (selectedRunId === undefined || parsedWorkflowData === undefined) {
      return;
    }
    setDummyWorkflowData(parsedWorkflowData);
    setUseDummyWorkflow(true);
  }, [selectedRunId, parsedWorkflowData, setDummyWorkflowData, setUseDummyWorkflow]);
};

const RunsList = ({
  workflowRuns,
  onRunSelect,
}: {
  workflowRuns: WorkflowRun[];
  onRunSelect: (runId: string) => void;
}) => {
  if (workflowRuns.length === 0) {
    return (
      <div className="text-muted-foreground flex h-32 items-center justify-center p-4 text-center text-sm">
        No workflow runs yet
      </div>
    );
  }

  return (
    <ScrollArea className="h-full w-full px-4 pt-4">
      <div className="space-y-2">
        {workflowRuns.map((run) => {
          const { queuedAt, startedAt, endedAt } = run;

          return (
            <button
              key={run.id as string}
              className="border-border bg-card hover:bg-accent/50 w-full border p-3 transition-colors"
              onClick={() => {
                onRunSelect(run.id as string);
              }}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-start">
                  <Badge variant={getRunStatusVariant(run.status)}>{run.status}</Badge>
                </div>

                <div className="text-muted-foreground space-y-1 text-xs">
                  {queuedAt !== null && (
                    <div className="flex justify-between">
                      <span>Queued:</span>
                      <span>{format(queuedAt, RUNS_DATE_FORMAT)}</span>
                    </div>
                  )}
                  {startedAt !== null && (
                    <div className="flex justify-between">
                      <span>Started:</span>
                      <span>{format(startedAt, RUNS_DATE_FORMAT)}</span>
                    </div>
                  )}
                  {endedAt !== null && (
                    <div className="flex justify-between">
                      <span>Ended:</span>
                      <span>{format(endedAt, RUNS_DATE_FORMAT)}</span>
                    </div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
};

const useRunsAutoSelect = (props: SidebarRunsTabProps) => {
  useSidebarTabAutoSelect('runs', props.selectedRunId);
};

const useSelectedRunPresentation = (props: SidebarRunsTabProps) => {
  const {
    flow,
    setDummyWorkflowData,
    setUseDummyWorkflow,
    setNodeRunPresentation,
    clearNodeRunPresentation,
  } = useFlow();

  const displayedNodeIds = useMemo(() => flow.nodes.map((node) => node.id), [flow.nodes]);
  const { client: trpc } = useTRPCPluginAPIs<RunsPlugin>('runs');

  useRunsData({
    trpc,
    displayedNodeIds,
    selectedRunId: props.selectedRunId,
    setDummyWorkflowData,
    setUseDummyWorkflow,
    setNodeRunPresentation,
    clearNodeRunPresentation,
  });
};

const RunsTrigger = ({ isRunning }: { isRunning: boolean }) => {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center">
      <div />
      <span className="justify-self-center">Runs</span>
      {isRunning ? (
        <div className="bg-primary ml-2 h-2 w-2 animate-[pulse_0.7s_infinite] rounded-full" />
      ) : null}
    </div>
  );
};

const RunsTriggerContainer = ({ runPollingEnabled, celQuery }: SidebarRunsTabProps) => {
  const { client: trpc } = useTRPCPluginAPIs<RunsPlugin>('runs');
  const workflowRuns = useWorkflowRuns({
    trpc,
    celQuery,
    runPollingEnabled,
  });
  const isRunning = hasRunningOrQueuedRuns(workflowRuns);
  return <RunsTrigger isRunning={isRunning} />;
};

const SidebarRunsTabContent = (props: SidebarRunsTabProps) => {
  useSelectedRunPresentation(props);

  const { client: trpc } = useTRPCPluginAPIs<RunsPlugin>('runs');
  const workflowRuns = useWorkflowRuns({
    trpc,
    celQuery: props.celQuery,
    runPollingEnabled: props.runPollingEnabled,
  });

  return <RunsList workflowRuns={workflowRuns} onRunSelect={props.setRunId} />;
};

/**
 * Sidebar tab that polls Inngest for workflow runs, lets users select a run, and switches the
 * editor into the corresponding run-inspection presentation state.
 *
 * The host app must register the `runs` plugin and provide a CEL query that scopes runs to the
 * current workflow.
 */
export const SidebarRunsTab: FluxerySidebarTabComponent<SidebarRunsTabProps> =
  createFluxerySidebarTab<SidebarRunsTabProps>({
    id: 'runs',
    contentClassName: 'min-h-0',
    label: (props) => (
      <RunsTriggerContainer
        celQuery={props.celQuery}
        runPollingEnabled={props.runPollingEnabled}
        selectedRunId={props.selectedRunId}
        setRunId={props.setRunId}
      />
    ),
    useAutoSelect: useRunsAutoSelect,
    render: (props) => <SidebarRunsTabContent {...props} />,
  });
