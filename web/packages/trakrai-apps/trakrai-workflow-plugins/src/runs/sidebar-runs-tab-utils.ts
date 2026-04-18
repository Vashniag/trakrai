import { FunctionRunStatus } from './inngest-graphql/graphql';

import type { WorkflowData, WorkflowRunData } from '@trakrai-workflow/core';

export const RUNS_DATE_FORMAT = 'MMM d, h:mm:ss a';
export const RUNS_POLL_INTERVAL = 2000;
export const RUNS_POLL_INTERVAL_LONG = 5000;
export const RUN_POLL_INTERVAL = 400;

const isStatus = (status: string, expected: FunctionRunStatus) => status === expected;

export const getRunStatusVariant = (status: string) => {
  switch (status) {
    case FunctionRunStatus.Completed:
      return 'default';
    case FunctionRunStatus.Failed:
    case FunctionRunStatus.Cancelled:
      return 'destructive';
    case FunctionRunStatus.Running:
      return 'secondary';
    case FunctionRunStatus.Queued:
      return 'outline';
  }
};

export const parseWorkflowData = (rawWorkflowData: string | undefined) => {
  if (rawWorkflowData === undefined) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(rawWorkflowData) as unknown;
    if (typeof parsed === 'object' && parsed !== null && 'nodes' in parsed && 'edges' in parsed) {
      return parsed as WorkflowData;
    }
    return undefined;
  } catch {
    return undefined;
  }
};

export const getWorkflowDataOutputId = (runData: WorkflowRunData | undefined) => {
  return (
    runData?.trace?.childrenSpans.find((span) => span.name === 'get-workflow')?.outputID ?? null
  );
};

export const hasRunningOrQueuedRuns = (statuses: Array<{ status: string }> | undefined) => {
  return (
    statuses?.some(
      (run) =>
        isStatus(run.status, FunctionRunStatus.Running) ||
        isStatus(run.status, FunctionRunStatus.Queued),
    ) ?? false
  );
};
