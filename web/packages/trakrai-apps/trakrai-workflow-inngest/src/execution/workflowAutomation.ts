import {
  createNodeRuntime,
  safeParseSchema,
  validateWorkflow,
  ExecutionSuccessHandle,
  type WorkflowLogger,
  type DependencyInfo,
  type Edge,
  type ExecutionResult,
  type Node,
  type NodeFunctions,
  type NodeHandlerRegistry,
  type NodeRuntime,
  type NodeSchemas,
  type RuntimeNodeFunctionRegistry,
  type WorkflowData,
  type JsonObject,
} from '@trakrai-workflow/core';
import { buildNodeEventId, buildNodeInput, isEventHandle } from '@trakrai-workflow/core/utils';
import { type Context, type EventPayload, type Inngest, NonRetriableError } from 'inngest';

type WorkflowValidationSuccess = {
  result: Partial<Record<string, DependencyInfo[]>>;
  valid: true;
};

type WorkflowValidationFailure = {
  errors: string[];
  valid: false;
};

type WorkflowValidationResult = WorkflowValidationSuccess | WorkflowValidationFailure;

/**
 * Application-provided workflow lookup used by {@link automation}.
 *
 * Returning `null` for `workflowChart` is treated as a terminal integration
 * failure and converted into a `NonRetriableError`.
 */
type GetWorkflowData<Params> = (params: Params) => Promise<{ workflowChart: WorkflowData | null }>;

const encodeEventName = (eventName: string) => {
  return Buffer.from(eventName, 'utf-8').toString('base64');
};
type ExecutionContext = {
  runId: string;
  eventId: string;
  invokeTimestamp: Date;
};

const LOG_MAX_DEPTH = 4;
const LOG_MAX_ARRAY_ITEMS = 10;
const LOG_MAX_OBJECT_KEYS = 20;
const LOG_MAX_STRING_LENGTH = 240;
const ASCII_BACKSPACE = 0x08;
const ASCII_VERTICAL_TAB = 0x0b;
const ASCII_FORM_FEED = 0x0c;
const ASCII_SHIFT_OUT = 0x0e;
const ASCII_UNIT_SEPARATOR = 0x1f;
const ASCII_DELETE = 0x7f;
const C1_CONTROL_END = 0x9f;
const NO_BREAK_SPACE = 0x00a0;
const ZERO_WIDTH_SPACE = 0x200b;
const RIGHT_TO_LEFT_MARK = 0x200f;
const WORD_JOINER = 0x2060;
const ZERO_WIDTH_NO_BREAK_SPACE = 0xfeff;

const isNormalizedLogChar = (char: string): boolean => {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) {
    return false;
  }

  return (
    (codePoint >= 0x00 && codePoint <= ASCII_BACKSPACE) ||
    codePoint === ASCII_VERTICAL_TAB ||
    codePoint === ASCII_FORM_FEED ||
    (codePoint >= ASCII_SHIFT_OUT && codePoint <= ASCII_UNIT_SEPARATOR) ||
    (codePoint >= ASCII_DELETE && codePoint <= C1_CONTROL_END) ||
    codePoint === NO_BREAK_SPACE ||
    (codePoint >= ZERO_WIDTH_SPACE && codePoint <= RIGHT_TO_LEFT_MARK) ||
    codePoint === WORD_JOINER ||
    codePoint === ZERO_WIDTH_NO_BREAK_SPACE
  );
};

const summarizeLogString = (value: string): string => {
  let normalizedCharCount = 0;
  const normalized = Array.from(value)
    .map((char) => {
      if (!isNormalizedLogChar(char)) {
        return char;
      }

      normalizedCharCount += 1;
      return char === '\u00A0' ? ' ' : '';
    })
    .join('')
    .replace(/\r\n?/g, '\n');

  const truncated = normalized.length > LOG_MAX_STRING_LENGTH;
  const preview = truncated ? `${normalized.slice(0, LOG_MAX_STRING_LENGTH)}...` : normalized;
  if (!truncated && normalizedCharCount === 0) {
    return preview;
  }

  const annotations: string[] = [];
  if (truncated) {
    annotations.push(`${value.length} chars`);
  }
  if (normalizedCharCount > 0) {
    annotations.push(`${normalizedCharCount} non-printable chars normalized`);
  }

  return `${preview} [${annotations.join(', ')}]`;
};

const summarizeLogValue = (value: unknown, depth = 0, seen = new WeakSet<object>()): unknown => {
  if (typeof value === 'string') {
    return summarizeLogString(value);
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'bigint') {
    return `${value.toString()}n`;
  }

  if (typeof value === 'function') {
    return `[Function ${value.name === '' ? 'anonymous' : value.name}]`;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    if (depth >= LOG_MAX_DEPTH) {
      return `[Array(${value.length})]`;
    }

    const items = value
      .slice(0, LOG_MAX_ARRAY_ITEMS)
      .map((item) => summarizeLogValue(item, depth + 1, seen));
    if (value.length > LOG_MAX_ARRAY_ITEMS) {
      items.push(`[${value.length - LOG_MAX_ARRAY_ITEMS} more items]`);
    }
    return items;
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }

    if (depth >= LOG_MAX_DEPTH) {
      return '[Object]';
    }

    if (value instanceof Error) {
      return {
        name: value.name,
        message: summarizeLogString(value.message),
        stack:
          value.stack === undefined || value.stack === ''
            ? undefined
            : summarizeLogString(value.stack),
      };
    }

    seen.add(value);

    const entries = Object.entries(value as Record<string, unknown>);
    const summary: Record<string, unknown> = {};
    for (const [key, entryValue] of entries.slice(0, LOG_MAX_OBJECT_KEYS)) {
      summary[key] = summarizeLogValue(entryValue, depth + 1, seen);
    }
    if (entries.length > LOG_MAX_OBJECT_KEYS) {
      summary.__truncatedKeys = `${entries.length - LOG_MAX_OBJECT_KEYS} more keys`;
    }

    seen.delete(value);
    return summary;
  }

  return String(value);
};

const generateEventName = (context: ExecutionContext, ...parts: string[]) => {
  const base = `${context.eventId}-${parts.join('-')}`;
  return encodeEventName(base);
};

/**
 * Loads the workflow definition for the current trigger and normalizes fetch
 * failures into `NonRetriableError` so Inngest does not retry on bad lookup
 * inputs or missing workflow data.
 */
const fetchWorkflow = async <Params>(params: Params, getWorkflowData: GetWorkflowData<Params>) => {
  try {
    const { workflowChart } = await getWorkflowData(params);
    if (workflowChart === null) {
      throw new Error('Workflow data is null');
    }
    return workflowChart;
  } catch (error) {
    throw new NonRetriableError(
      `Failed to fetch workflow data for ${JSON.stringify(params)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/**
 * Validates the workflow graph against the provided schemas and runtime
 * handlers, while first marking async node executors so the core validator can
 * calculate the correct dependency map.
 */
const runWorkflowValidation = <
  S extends NodeSchemas,
  FContext extends object,
  HContext extends object,
>(
  workflowChart: WorkflowData,
  nodeSchemas: S,
  nodeFunctions: NodeFunctions<S, FContext & ExecutionContext>,
  nodeHandlers?: NodeHandlerRegistry<HContext & ExecutionContext>,
): WorkflowValidationResult => {
  const asyncNodeTypes = new Set<string>();
  for (const nodeType of Object.keys(nodeSchemas)) {
    const nodeFn = nodeFunctions[nodeType];
    const fnCtorName =
      nodeFn === undefined
        ? undefined
        : (nodeFn as unknown as { constructor: { name: string } }).constructor.name;
    const isAsync = fnCtorName === 'AsyncFunction';
    if (isAsync) {
      asyncNodeTypes.add(nodeType);
    }
  }
  for (const nodeType of Object.keys(nodeHandlers ?? {})) {
    const handler = nodeHandlers?.[nodeType];
    if (handler === undefined) {
      continue;
    }
    const executeCtorName = (handler.execute as unknown as { constructor: { name: string } })
      .constructor.name;
    const isAsync = executeCtorName === 'AsyncFunction';
    if (isAsync) {
      asyncNodeTypes.add(nodeType);
    }
  }
  const validationResult = validateWorkflow(
    workflowChart.nodes,
    workflowChart.edges,
    nodeSchemas,
    asyncNodeTypes,
    nodeHandlers,
  );
  if (validationResult.valid) {
    return { result: validationResult.dependencyMap, valid: true };
  }
  return { errors: validationResult.errors, valid: false };
};

const checkDependencyFailure = (
  dep: DependencyInfo,
  resultMap: Map<string, ExecutionResult>,
): boolean => {
  if (dep.sourceHandle === ExecutionSuccessHandle) {
    const depStatus = resultMap.get(dep.sourceNodeId);
    if (depStatus === undefined) {
      return true;
    }

    if (dep.conditional !== undefined) {
      return depStatus.success !== dep.conditional;
    }

    return depStatus.success === false;
  }

  const isEvent = isEventHandle(dep.sourceHandle);
  let resultId = dep.sourceNodeId;
  let sourceKey = dep.sourceHandle;
  if (isEvent.isEvent) {
    resultId = buildNodeEventId(dep.sourceNodeId, isEvent.eventName);
    sourceKey = isEvent.eventHandle;
  }
  const depStatus = resultMap.get(resultId);

  if (depStatus === undefined || depStatus.success === false) {
    return true;
  }

  if (dep.conditional !== undefined) {
    const conditionalResult = (depStatus.data as Partial<Record<string, unknown>>)[sourceKey];
    if (conditionalResult !== dep.conditional) {
      return true;
    }
  }

  return false;
};

const setFailureResult = (
  resultMap: Map<string, ExecutionResult>,
  id: string,
  error: string,
): void => {
  resultMap.set(id, { id, success: false, error });
};

const DEPENDENCY_FAILURE_REASON = 'Dependency failure';

const buildWaitStepId = (
  context: ExecutionContext,
  sourceNodeId: string,
  targetNodeId: string,
  suffix?: string,
) => {
  const base = `wait-for-${context.eventId}-${sourceNodeId}-dep-${targetNodeId}`;
  if (suffix !== undefined && suffix !== '') {
    return `${base}-${suffix}`;
  }
  return base;
};

/**
 * Stores the resolved payload for an event dependency in the shared result map.
 *
 * Missing events, unknown schemas, and schema-parse failures are all converted
 * into synthetic failed execution results so downstream dependency checks can
 * short-circuit consistently.
 */
const processEventDependencyData = <Context extends ExecutionContext>(
  eventData: EventPayload | null,
  dep: DependencyInfo,
  eventName: string,
  nodeRuntime: NodeRuntime<Context>,
  resultMap: Map<string, ExecutionResult>,
): void => {
  const nodeEventId = buildNodeEventId(dep.sourceNodeId, eventName);

  if (eventData === null) {
    setFailureResult(
      resultMap,
      nodeEventId,
      `Timeout waiting for event ${eventName} from node ${dep.sourceNodeId}`,
    );
    return;
  }

  const sourceNodeSchema = nodeRuntime.resolveNodeSchemaSourceById(dep.sourceNodeId);
  if (sourceNodeSchema === undefined) {
    setFailureResult(
      resultMap,
      nodeEventId,
      `Source node schema not found for node ${dep.sourceNodeId}`,
    );
    return;
  }

  const eventSchema = sourceNodeSchema.events?.[eventName]?.data;
  if (eventSchema === undefined) {
    setFailureResult(
      resultMap,
      nodeEventId,
      `Event schema not found for event ${eventName} from node ${dep.sourceNodeId}`,
    );
    return;
  }

  const parsedData = safeParseSchema(eventSchema, eventData.data);
  if (parsedData.success) {
    resultMap.set(nodeEventId, { id: nodeEventId, success: true, data: parsedData.data });
  } else {
    setFailureResult(
      resultMap,
      nodeEventId,
      `Invalid event data for event ${eventName} from node ${dep.sourceNodeId}: ${parsedData.error}`,
    );
  }
};

/**
 * Executes a single node once its dependencies have been satisfied and
 * publishes the event names that downstream nodes must wait on.
 */
const executeNode = async <Context extends ExecutionContext>(
  node: Node,
  dependencies: DependencyInfo[],
  resultMap: Map<string, ExecutionResult>,
  context: Context,
  nodeRuntime: NodeRuntime<Context>,
  logger: WorkflowLogger,
): Promise<ExecutionResult> => {
  const nodeId = node.id;
  const nodeType = node.type;
  if (nodeType === undefined) {
    throw new NonRetriableError(`Node type is undefined for node ${nodeId}`);
  }
  const nodeHandler = nodeRuntime.getNodeHandler(nodeType);
  if (nodeHandler === undefined) {
    throw new NonRetriableError(`Node handler not found for node type ${nodeType}`);
  }
  const nodeSchema = nodeRuntime.resolveNodeSchemaSource(node);
  if (nodeSchema === undefined) {
    throw new NonRetriableError(`Node schema not found for node type ${nodeType}`);
  }

  const input = buildNodeInput(node, dependencies, resultMap);
  const eventMap = Object.fromEntries(
    Object.keys(nodeSchema.events ?? {}).map((event) => {
      return [event, generateEventName(context, nodeId, event)];
    }),
  );
  logger.info(`Executing node ${nodeId} (${nodeType}) with input:`, summarizeLogValue(input));
  const output = await nodeHandler.execute({
    node,
    input,
    context,
    events: eventMap,
    logger,
  });
  logger.info(`Node ${nodeId} completed successfully with output:`, summarizeLogValue(output));
  return {
    id: nodeId,
    success: true,
    data: output,
  };
};

/**
 * Executes a validated Fluxery workflow inside an Inngest function handler.
 *
 * The helper fetches workflow data, validates the graph before any node runs,
 * then coordinates node execution by waiting for upstream completion and event
 * signals through Inngest steps. Nodes with dependency mode `all` wait for
 * every dependency; nodes with dependency mode `any` race eligible upstream
 * sources and execute from the first successful branch.
 *
 * @typeParam S - Registry of node schemas available to the workflow.
 * @typeParam FunctionContext - Extra context injected into node functions from the triggering event.
 * @typeParam HandlerContext - Extra context injected into custom node handlers from the triggering event.
 * @typeParam Params - Parameters derived from the triggering event and used to load workflow data.
 * @param context - Inngest function context, including `event`, `step`, `runId`, and Fluxery's logger.
 * @param nodeSchemas - Node schema registry used for validation and event parsing.
 * @param nodeFunctions - Default node executors keyed by node type.
 * @param getParams - Maps `event.data` into the lookup parameters expected by `getWorkflowData`.
 * @param getWorkflowData - Loads the workflow graph for this execution.
 * @param options.nodeHandlers - Optional custom runtime handlers that can override dependency behavior.
 * @returns Execution results keyed by node ID, plus synthetic event result IDs for resolved event dependencies.
 */
export const automation = async <
  S extends NodeSchemas,
  FunctionContext extends JsonObject,
  HandlerContext extends JsonObject,
  Params,
>(
  {
    event,
    step,
    runId,
    logger,
  }: Context<
    Inngest<{
      id: string;
    }>,
    {
      logger: WorkflowLogger;
    }
  >,
  nodeSchemas: S,
  nodeFunctions: NodeFunctions<S, FunctionContext & ExecutionContext>,
  getParams: (eventData: JsonObject) => Params,
  getWorkflowData: GetWorkflowData<Params>,
  options?: {
    nodeHandlers?: NodeHandlerRegistry<HandlerContext & ExecutionContext>;
  },
) => {
  const eventId = event.id;
  if (eventId === undefined) {
    throw new NonRetriableError('Event ID is undefined');
  }
  const executionTimestamp = event.ts !== undefined ? new Date(event.ts) : new Date();
  const contextData = {
    ...(event.data as HandlerContext & FunctionContext & JsonObject),
    runId,
    eventId,
    invokeTimestamp: executionTimestamp,
  };
  const params = getParams(event.data as JsonObject);
  const workflowChart = await step.run('get-workflow', () =>
    fetchWorkflow(params, getWorkflowData),
  );
  const nodeRuntime = createNodeRuntime<HandlerContext & FunctionContext & ExecutionContext>({
    nodes: workflowChart.nodes as Node[],
    edges: workflowChart.edges as Edge[],
    nodeSchemas,
    nodeFunctions: nodeFunctions as unknown as RuntimeNodeFunctionRegistry<
      HandlerContext & FunctionContext & ExecutionContext
    >,
    nodeHandlers: options?.nodeHandlers,
  });
  const workflowValidationResult = await step.run('validate-workflow', () =>
    runWorkflowValidation(
      workflowChart as WorkflowData,
      nodeSchemas,
      nodeFunctions,
      options?.nodeHandlers,
    ),
  );
  if (!workflowValidationResult.valid) {
    throw new NonRetriableError(
      `Workflow validation failed: ${workflowValidationResult.errors.join(', ')}`,
    );
  }

  const dependencyMap = workflowValidationResult.result;
  const resultMap = new Map<string, ExecutionResult>();
  const nodes = workflowChart.nodes as Node[];
  const edges = workflowChart.edges as Edge[];

  const getDependencyModeForNode = (node: Node) => {
    const handler = nodeRuntime.getNodeHandler(node.type);
    if (handler === undefined) {
      return 'all';
    }
    return handler.getDependencyMode({
      node,
      nodes,
      edges,
      nodeSchemas,
      resolveNodeSchema: nodeRuntime.resolveNodeSchemaById,
      resolveNodeSchemaSource: nodeRuntime.resolveNodeSchemaSourceById,
    });
  };

  type AnyDependencyWaitResult =
    | { kind: 'source'; sourceNodeId: string; eventData: EventPayload | null }
    | { kind: 'merge'; sourceNodeId: string };

  const waitForAnyDependency = async (node: Node, dependencies: DependencyInfo[]) => {
    const dependencyGroups = new Map<string, DependencyInfo[]>();
    for (const dep of dependencies) {
      const entries = dependencyGroups.get(dep.sourceNodeId) ?? [];
      entries.push(dep);
      dependencyGroups.set(dep.sourceNodeId, entries);
    }

    const sourceNodeIds = Array.from(dependencyGroups.keys());
    if (sourceNodeIds.length === 0) {
      return null;
    }

    const mergeEventName = generateEventName(contextData, node.id, 'merge-any');
    const waiters = new Map<string, Promise<AnyDependencyWaitResult>>();

    for (const sourceNodeId of sourceNodeIds) {
      const waitForSource = step
        .waitForEvent(buildWaitStepId(contextData, sourceNodeId, node.id, 'completion'), {
          event: generateEventName(contextData, sourceNodeId),
          timeout: '1y',
        })
        .then((eventData: EventPayload | null) => ({
          kind: 'source' as const,
          sourceNodeId,
          eventData,
        }));
      const waitForMerge = step
        .waitForEvent(buildWaitStepId(contextData, sourceNodeId, node.id, 'merge'), {
          event: mergeEventName,
          timeout: '1y',
        })
        .then(() => ({
          kind: 'merge' as const,
          sourceNodeId,
        }));

      waiters.set(sourceNodeId, Promise.race([waitForSource, waitForMerge]));
    }

    // Each candidate source waits for both its own completion and a shared
    // merge signal. The first source that satisfies every dependency emits the
    // merge event so the remaining contenders can stop waiting.
    const pendingSources = new Set(sourceNodeIds);
    while (pendingSources.size > 0) {
      const pendingWaiters = Array.from(pendingSources)
        .map((sourceNodeId) => waiters.get(sourceNodeId))
        .filter((waiter): waiter is Promise<AnyDependencyWaitResult> => waiter !== undefined);
      if (pendingWaiters.length === 0) {
        break;
      }
      const next = await Promise.race(pendingWaiters);
      pendingSources.delete(next.sourceNodeId);

      if (next.kind === 'merge') {
        return null;
      }

      if (next.eventData === null) {
        continue;
      }

      const depsForSource = dependencyGroups.get(next.sourceNodeId) ?? [];
      const eventDeps = depsForSource.flatMap((dep) => {
        const event = isEventHandle(dep.sourceHandle);
        return event.isEvent ? [{ dep, eventName: event.eventName }] : [];
      });

      await Promise.all(
        eventDeps.map(({ dep, eventName }: { dep: DependencyInfo; eventName: string }) =>
          step
            .waitForEvent(
              buildWaitStepId(contextData, dep.sourceNodeId, node.id, `event-${eventName}`),
              {
                event: generateEventName(contextData, dep.sourceNodeId, eventName),
                timeout: '1y',
              },
            )
            .then((eventData: EventPayload | null) => {
              processEventDependencyData(eventData, dep, eventName, nodeRuntime, resultMap);
              return eventData;
            }),
        ),
      );

      const hasDependencyFailure = depsForSource.some((dep) =>
        checkDependencyFailure(dep, resultMap),
      );
      if (!hasDependencyFailure) {
        await step.sendEvent(`emit-merge-${eventId}-${node.id}`, {
          name: mergeEventName,
          data: { sourceNodeId: next.sourceNodeId },
        });
        return next.sourceNodeId;
      }
    }

    return null;
  };

  await Promise.all(
    nodes.map(async (node: Node) => {
      const nodeId = node.id;
      const dependencies = dependencyMap[nodeId] ?? [];
      const dependencyMode = getDependencyModeForNode(node);
      let executionDependencies = dependencies;

      if (dependencies.length > 0) {
        if (dependencyMode === 'any') {
          const winnerSourceId = await waitForAnyDependency(node, dependencies);
          if (winnerSourceId === null) {
            setFailureResult(resultMap, nodeId, DEPENDENCY_FAILURE_REASON);
            await step.sendEvent(`emit-failure-${eventId}-${nodeId}`, {
              name: generateEventName(contextData, nodeId),
              data: { reason: DEPENDENCY_FAILURE_REASON },
            });
            return;
          }
          executionDependencies = dependencies.filter(
            (dep: DependencyInfo) => dep.sourceNodeId === winnerSourceId,
          );
        } else {
          await Promise.all(
            dependencies.map((dep: DependencyInfo) =>
              step.waitForEvent(
                buildWaitStepId(contextData, dep.sourceNodeId, nodeId, 'completion'),
                {
                  event: generateEventName(contextData, dep.sourceNodeId),
                  timeout: '1y',
                },
              ),
            ),
          );

          const eventDeps = dependencies.flatMap((dep: DependencyInfo) => {
            const event = isEventHandle(dep.sourceHandle);
            return event.isEvent ? [{ dep, eventName: event.eventName }] : [];
          });

          await Promise.all(
            eventDeps.map(({ dep, eventName }: { dep: DependencyInfo; eventName: string }) =>
              step
                .waitForEvent(
                  buildWaitStepId(contextData, dep.sourceNodeId, nodeId, `event-${eventName}`),
                  {
                    event: generateEventName(contextData, dep.sourceNodeId, eventName),
                    timeout: '1y',
                  },
                )
                .then((eventData: EventPayload | null) => {
                  processEventDependencyData(eventData, dep, eventName, nodeRuntime, resultMap);
                  return eventData;
                }),
            ),
          );
          const hasDependencyFailure = dependencies.some((dep: DependencyInfo) =>
            checkDependencyFailure(dep, resultMap),
          );
          if (hasDependencyFailure) {
            setFailureResult(resultMap, nodeId, DEPENDENCY_FAILURE_REASON);
            await step.sendEvent(`emit-failure-${eventId}-${nodeId}`, {
              name: generateEventName(contextData, nodeId),
              data: { reason: DEPENDENCY_FAILURE_REASON },
            });
            return;
          }
        }
      }

      try {
        const result = await step.run(`execute-${nodeId}`, () =>
          executeNode(node, executionDependencies, resultMap, contextData, nodeRuntime, logger),
        );
        resultMap.set(nodeId, result);
        await step.sendEvent(`emit-completion-${eventId}-${nodeId}`, {
          name: generateEventName(contextData, nodeId),
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        setFailureResult(resultMap, nodeId, errorMessage);
        await step.sendEvent(`emit-failure-${eventId}-${nodeId}`, {
          name: generateEventName(contextData, nodeId),
          data: { reason: errorMessage },
        });
      }
    }),
  );

  return {
    results: Object.fromEntries(resultMap),
  };
};

/**
 * Infers the event payload shape required to trigger an automated workflow.
 *
 * The helper removes the execution-managed fields injected by this package
 * (`runId`, `eventId`, and `invokeTimestamp`) from both node-function and
 * node-handler contexts, leaving only the application data callers must send.
 */
export type InferContext<T, H, S extends NodeSchemas> = (T extends NodeFunctions<S, infer C>
  ? Omit<C, keyof ExecutionContext>
  : never) &
  (H extends NodeHandlerRegistry<infer HC> ? Omit<HC, keyof ExecutionContext> : never);
