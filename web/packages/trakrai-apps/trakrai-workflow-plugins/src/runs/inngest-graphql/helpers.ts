import { type NodeRunDetails, NodeRunStatus, type WorkflowRunData } from '@trakrai-workflow/core';
import { z } from 'zod';

import {
  RunsV2OrderByField,
  GetRunsDocument,
  type GetRunsQuery,
  type GetRunsQueryVariables,
  RunTraceSpanStatus,
  type GetRunQuery,
  type GetTraceResultQuery,
  type GetTraceResultQueryVariables,
  GetTraceResultDocument,
  GetEventV2PayloadDocument,
  type GetEventV2PayloadQuery,
  type GetEventV2PayloadQueryVariables,
  type GetRunQueryVariables,
  GetRunDocument,
  GetEventWithRunsDocument,
  type GetEventWithRunsQueryVariables,
  type GetEventWithRunsQuery,
} from './graphql';

import type { GraphQLClient } from 'graphql-request';

const parseDateSafe = (dateString: unknown) =>
  z.coerce.date().nullable().catch(null).parse(dateString);

/**
 * Fetches workflow runs from Inngest and normalizes timestamp fields into `Date` instances when
 * they are present.
 */
export const getRuns = async (client: GraphQLClient, startTime: Date, celQuery: string) => {
  const variables: GetRunsQueryVariables = {
    appIDs: null,
    startTime: startTime.toISOString(),
    status: null,
    timeField: RunsV2OrderByField.QueuedAt,
    functionRunCursor: null,
    celQuery,
    preview: false,
  };

  const result = await client.request<GetRunsQuery, GetRunsQueryVariables>(
    GetRunsDocument,
    variables,
  );

  return result.runs.edges
    .map((edge) => {
      if (edge.node.id === undefined) {
        return undefined;
      }
      return {
        id: edge.node.id as string,
        status: edge.node.status,
        queuedAt: parseDateSafe(edge.node.queuedAt),
        startedAt: parseDateSafe(edge.node.startedAt),
        endedAt: parseDateSafe(edge.node.endedAt),
      };
    })
    .filter((run): run is NonNullable<typeof run> => run !== undefined);
};

/**
 * Derives the editor-facing node status from Inngest trace spans for a specific workflow node.
 *
 * The helper inspects both execution spans and completion/failure emission spans so the UI can
 * distinguish waiting, running, retrying, failing, failed, and completed states.
 */
export const getNodeRunStatus = (
  runData: GetRunQuery['run'] | WorkflowRunData | undefined,
  nodeId: string,
) => {
  const nodeExecutionSpan = (() => {
    if (runData === undefined) {
      return null;
    }
    return runData?.trace?.childrenSpans.find((span) => span.name === `execute-${nodeId}`) ?? null;
  })();
  const nodeCompletionEvent = (() => {
    if (runData === undefined) {
      return null;
    }
    return (
      runData?.trace?.childrenSpans.find(
        (span) =>
          (span.name.startsWith(`emit-completion-`) || span.name.startsWith(`emit-failure-`)) &&
          span.name.includes(nodeId),
      ) ?? null
    );
  })();
  if (nodeCompletionEvent !== null) {
    if (nodeCompletionEvent.name.startsWith('emit-failure-')) {
      return {
        nodeStatus: NodeRunStatus.Failed,
        nodeExecutionSpan,
        nodeCompletionEvent,
      };
    }
    if (nodeCompletionEvent.name.startsWith('emit-completion-')) {
      return {
        nodeStatus: NodeRunStatus.Completed,
        nodeExecutionSpan,
        nodeCompletionEvent,
      };
    }
  }
  if (nodeExecutionSpan !== null) {
    if (nodeExecutionSpan.status === RunTraceSpanStatus.Failed) {
      return {
        nodeStatus: NodeRunStatus.Failing,
        nodeExecutionSpan,
        nodeCompletionEvent: null,
      };
    }
    if (nodeExecutionSpan.status === RunTraceSpanStatus.Running) {
      if (nodeExecutionSpan.childrenSpans.length <= 1) {
        return {
          nodeStatus: NodeRunStatus.Running,
          nodeExecutionSpan,
          nodeCompletionEvent: null,
        };
      }
      return {
        nodeStatus: NodeRunStatus.Retrying,
        nodeExecutionSpan,
        nodeCompletionEvent: null,
      };
    }
    if (nodeExecutionSpan.status === RunTraceSpanStatus.Completed) {
      return {
        nodeStatus: NodeRunStatus.Completed,
        nodeExecutionSpan,
        nodeCompletionEvent: null,
      };
    }
  }
  return {
    nodeStatus: NodeRunStatus.Waiting,
    nodeExecutionSpan: null,
    nodeCompletionEvent: null,
  };
};

/**
 * Loads a trace result payload by output id from the Inngest GraphQL API.
 */
export const getTraceResult = async (client: GraphQLClient, traceId: string) => {
  const variables: GetTraceResultQueryVariables = {
    traceID: traceId,
  };

  const result = await client.request<GetTraceResultQuery, GetTraceResultQueryVariables>(
    GetTraceResultDocument,
    variables,
  );

  return result.runTraceSpanOutputByID;
};

const getEventV2Payload = async (client: GraphQLClient, eventId: string) => {
  const variables = {
    eventID: eventId,
  };

  const result = await client.request<GetEventV2PayloadQuery, GetEventV2PayloadQueryVariables>(
    GetEventV2PayloadDocument,
    variables,
  );

  return result.eventV2;
};

/**
 * Expands Inngest run data into the richer `NodeRunDetails` shape consumed by Fluxery tooltips and
 * node decorations.
 *
 * Depending on the node state, this may resolve failure metadata, retry errors, or the successful
 * node output payload from separate trace results.
 */
export const getNodeOutputFromRunData = async (
  client: GraphQLClient,
  runData: GetRunQuery['run'],
  nodeId: string,
): Promise<NodeRunDetails> => {
  const { nodeExecutionSpan, nodeCompletionEvent, nodeStatus } = getNodeRunStatus(runData, nodeId);
  if (nodeStatus === NodeRunStatus.Waiting) {
    return {
      nodeStatus,
    };
  }
  const executionOutputId = nodeExecutionSpan?.outputID;
  const completionEventOutputId = nodeCompletionEvent?.outputID;
  const queuedAt = parseDateSafe(nodeExecutionSpan?.queuedAt);
  const startedAt = parseDateSafe(nodeExecutionSpan?.startedAt);
  const endedAt = parseDateSafe(nodeExecutionSpan?.endedAt);
  if (nodeStatus === NodeRunStatus.Failed) {
    const failEventOutputTraceData = await getTraceResult(client, completionEventOutputId ?? '');
    const eventOutputDataData =
      ((failEventOutputTraceData.data ?? '{}') as string).length > 0
        ? ((failEventOutputTraceData.data ?? '{}') as string)
        : '{}';
    const failEventIdParsed = z
      .object({ ids: z.array(z.string()).optional() })
      .safeParse(JSON.parse(eventOutputDataData));
    const failEventId = failEventIdParsed.data?.ids?.[0];
    let failureReason = 'Unknown error';
    if (failEventId !== undefined && failEventId !== '') {
      const failEventData = await getEventV2Payload(client, failEventIdParsed.data?.ids?.[0] ?? '');
      const failureReasonRawData = failEventData.raw.length > 0 ? failEventData.raw : '{}';
      const failureReasonParsed = z
        .object({ data: z.object({ reason: z.string().optional() }).optional() })
        .safeParse(JSON.parse(failureReasonRawData));
      failureReason = failureReasonParsed.data?.data?.reason ?? failureReason;
    }
    return {
      nodeStatus,
      failureReason,
      queuedAt,
      startedAt,
      endedAt,
      attempts: nodeExecutionSpan?.attempts ?? null,
    };
  }
  if (nodeStatus === NodeRunStatus.Failing || nodeStatus === NodeRunStatus.Retrying) {
    const failingOutputId = nodeExecutionSpan.childrenSpans
      .filter((span) => span.outputID !== null)
      .sort((a, b) => {
        const aQueuedAt = parseDateSafe(a.queuedAt)?.getTime() ?? 0;
        const bQueuedAt = parseDateSafe(b.queuedAt)?.getTime() ?? 0;
        return bQueuedAt - aQueuedAt;
      })[0]?.outputID;
    const executionOutput = await getTraceResult(
      client,
      failingOutputId ?? executionOutputId ?? '',
    );
    const failingErrorMessage = executionOutput.error?.message;
    const failureErrorStack = executionOutput.error?.stack;
    return {
      nodeStatus,
      failingErrorMessage: failingErrorMessage ?? null,
      failureErrorStack: failureErrorStack ?? null,
      queuedAt,
      startedAt,
      endedAt,
      attempts: nodeExecutionSpan.attempts ?? null,
    };
  }
  const executionOutput = await getTraceResult(client, executionOutputId ?? '');
  const executionOutputRawData =
    ((executionOutput.data ?? '{}') as string).length > 0
      ? ((executionOutput.data ?? '{}') as string)
      : '{}';
  const parsedOutput = (JSON.parse(executionOutputRawData) as { data?: unknown }).data;
  return {
    nodeStatus,
    queuedAt,
    startedAt,
    endedAt,
    attempts: nodeExecutionSpan?.attempts ?? null,
    output: parsedOutput,
  };
};

/**
 * Fetches a single Inngest run including the trace tree used by the runs sidebar.
 */
export const getRunData = async (client: GraphQLClient, runId: string) => {
  const variables: GetRunQueryVariables = {
    runID: runId,
    preview: false,
  };
  const result = await client.request<GetRunQuery, GetRunQueryVariables>(GetRunDocument, variables);
  return result.run;
};

/**
 * Looks up the first function run associated with an Inngest event id.
 *
 * Returns `null` when the event cannot be found or when it has not produced any function runs yet.
 */
export const getFunctionRunFromEvent = async (client: GraphQLClient, eventId: string) => {
  try {
    const data = await client.request<GetEventWithRunsQuery, GetEventWithRunsQueryVariables>(
      GetEventWithRunsDocument,
      {
        eventID: eventId,
      },
    );
    if (data.eventV2.runs.length === 0) {
      return null;
    }
    return (data.eventV2.runs[0]?.id as string | null | undefined) ?? null;
  } catch {
    return null;
  }
};
