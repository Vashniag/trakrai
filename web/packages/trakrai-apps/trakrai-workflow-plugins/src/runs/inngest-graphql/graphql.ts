import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = {
  [_ in K]?: never;
};
export type Incremental<T> =
  | T
  | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string };
  String: { input: string; output: string };
  Boolean: { input: boolean; output: boolean };
  Int: { input: number; output: number };
  Float: { input: number; output: number };
  Bytes: { input: any; output: any };
  Environment: { input: any; output: any };
  Int64: { input: any; output: any };
  Map: { input: any; output: any };
  SpanMetadataKind: { input: any; output: any };
  SpanMetadataScope: { input: any; output: any };
  SpanMetadataValues: { input: any; output: any };
  Time: { input: any; output: any };
  ULID: { input: any; output: any };
  UUID: { input: any; output: any };
  Uint: { input: any; output: any };
  Unknown: { input: any; output: any };
};

export type ActionVersionQuery = {
  dsn: Scalars['String']['input'];
  versionMajor?: InputMaybe<Scalars['Int']['input']>;
  versionMinor?: InputMaybe<Scalars['Int']['input']>;
};

export type App = {
  __typename?: 'App';
  appVersion?: Maybe<Scalars['String']['output']>;
  autodiscovered: Scalars['Boolean']['output'];
  checksum?: Maybe<Scalars['String']['output']>;
  connected: Scalars['Boolean']['output'];
  error?: Maybe<Scalars['String']['output']>;
  externalID: Scalars['String']['output'];
  framework?: Maybe<Scalars['String']['output']>;
  functionCount: Scalars['Int']['output'];
  functions: Array<Function>;
  id: Scalars['ID']['output'];
  method: AppMethod;
  name: Scalars['String']['output'];
  sdkLanguage: Scalars['String']['output'];
  sdkVersion: Scalars['String']['output'];
  url?: Maybe<Scalars['String']['output']>;
};

export enum AppMethod {
  Api = 'API',
  Connect = 'CONNECT',
  Serve = 'SERVE',
}

export type AppsFilterV1 = {
  method?: InputMaybe<AppMethod>;
};

export type CancellationConfiguration = {
  __typename?: 'CancellationConfiguration';
  condition?: Maybe<Scalars['String']['output']>;
  event: Scalars['String']['output'];
  timeout?: Maybe<Scalars['String']['output']>;
};

export type ConcurrencyConfiguration = {
  __typename?: 'ConcurrencyConfiguration';
  key?: Maybe<Scalars['String']['output']>;
  limit: ConcurrencyLimitConfiguration;
  scope: ConcurrencyScope;
};

export type ConcurrencyLimitConfiguration = {
  __typename?: 'ConcurrencyLimitConfiguration';
  isPlanLimit?: Maybe<Scalars['Boolean']['output']>;
  value: Scalars['Int']['output'];
};

export enum ConcurrencyScope {
  Account = 'ACCOUNT',
  Environment = 'ENVIRONMENT',
  Function = 'FUNCTION',
}

export enum ConnectV1ConnectionStatus {
  Connected = 'CONNECTED',
  Disconnected = 'DISCONNECTED',
  Disconnecting = 'DISCONNECTING',
  Draining = 'DRAINING',
  Ready = 'READY',
}

export type ConnectV1WorkerConnection = {
  __typename?: 'ConnectV1WorkerConnection';
  app?: Maybe<App>;
  appID?: Maybe<Scalars['UUID']['output']>;
  appName?: Maybe<Scalars['String']['output']>;
  appVersion?: Maybe<Scalars['String']['output']>;
  buildId?: Maybe<Scalars['String']['output']>;
  connectedAt: Scalars['Time']['output'];
  cpuCores: Scalars['Int']['output'];
  disconnectReason?: Maybe<Scalars['String']['output']>;
  disconnectedAt?: Maybe<Scalars['Time']['output']>;
  functionCount: Scalars['Int']['output'];
  gatewayId: Scalars['ULID']['output'];
  groupHash: Scalars['String']['output'];
  id: Scalars['ULID']['output'];
  instanceId: Scalars['String']['output'];
  lastHeartbeatAt?: Maybe<Scalars['Time']['output']>;
  maxWorkerConcurrency: Scalars['Int64']['output'];
  memBytes: Scalars['Int']['output'];
  os: Scalars['String']['output'];
  sdkLang: Scalars['String']['output'];
  sdkPlatform: Scalars['String']['output'];
  sdkVersion: Scalars['String']['output'];
  status: ConnectV1ConnectionStatus;
  /** @deprecated buildId is deprecated. Use appVersion instead. */
  syncId?: Maybe<Scalars['UUID']['output']>;
  workerIp: Scalars['String']['output'];
};

export type ConnectV1WorkerConnectionEdge = {
  __typename?: 'ConnectV1WorkerConnectionEdge';
  cursor: Scalars['String']['output'];
  node: ConnectV1WorkerConnection;
};

export type ConnectV1WorkerConnectionsConnection = {
  __typename?: 'ConnectV1WorkerConnectionsConnection';
  edges: Array<ConnectV1WorkerConnectionEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type ConnectV1WorkerConnectionsFilter = {
  appIDs?: InputMaybe<Array<Scalars['UUID']['input']>>;
  from?: InputMaybe<Scalars['Time']['input']>;
  status?: InputMaybe<Array<ConnectV1ConnectionStatus>>;
  timeField?: InputMaybe<ConnectV1WorkerConnectionsOrderByField>;
  until?: InputMaybe<Scalars['Time']['input']>;
};

export type ConnectV1WorkerConnectionsOrderBy = {
  direction: ConnectV1WorkerConnectionsOrderByDirection;
  field: ConnectV1WorkerConnectionsOrderByField;
};

export enum ConnectV1WorkerConnectionsOrderByDirection {
  Asc = 'ASC',
  Desc = 'DESC',
}

export enum ConnectV1WorkerConnectionsOrderByField {
  ConnectedAt = 'CONNECTED_AT',
  DisconnectedAt = 'DISCONNECTED_AT',
  LastHeartbeatAt = 'LAST_HEARTBEAT_AT',
}

export type CreateAppInput = {
  url: Scalars['String']['input'];
};

export type CreateDebugSessionInput = {
  functionSlug: Scalars['String']['input'];
  runID?: InputMaybe<Scalars['String']['input']>;
  workspaceId?: Scalars['ID']['input'];
};

export type CreateDebugSessionResponse = {
  __typename?: 'CreateDebugSessionResponse';
  debugRunID: Scalars['ULID']['output'];
  debugSessionID: Scalars['ULID']['output'];
};

export type DebounceConfiguration = {
  __typename?: 'DebounceConfiguration';
  key?: Maybe<Scalars['String']['output']>;
  period: Scalars['String']['output'];
};

export type DebugRun = {
  __typename?: 'DebugRun';
  debugTraces?: Maybe<Array<RunTraceSpan>>;
};

export type DebugRunQuery = {
  debugRunID?: InputMaybe<Scalars['String']['input']>;
  functionSlug: Scalars['String']['input'];
  runID?: InputMaybe<Scalars['String']['input']>;
  workspaceId?: Scalars['ID']['input'];
};

export type DebugSession = {
  __typename?: 'DebugSession';
  debugRuns?: Maybe<Array<DebugSessionRun>>;
};

export type DebugSessionQuery = {
  debugSessionID?: InputMaybe<Scalars['String']['input']>;
  functionSlug: Scalars['String']['input'];
  runID?: InputMaybe<Scalars['String']['input']>;
  workspaceId?: Scalars['ID']['input'];
};

export type DebugSessionRun = {
  __typename?: 'DebugSessionRun';
  debugRunID?: Maybe<Scalars['ULID']['output']>;
  endedAt?: Maybe<Scalars['Time']['output']>;
  queuedAt: Scalars['Time']['output'];
  startedAt?: Maybe<Scalars['Time']['output']>;
  status: RunTraceSpanStatus;
  tags?: Maybe<Array<Scalars['String']['output']>>;
  versions?: Maybe<Array<Scalars['String']['output']>>;
};

export type Event = {
  __typename?: 'Event';
  createdAt?: Maybe<Scalars['Time']['output']>;
  externalID?: Maybe<Scalars['String']['output']>;
  functionRuns?: Maybe<Array<FunctionRun>>;
  id: Scalars['ULID']['output'];
  name?: Maybe<Scalars['String']['output']>;
  payload?: Maybe<Scalars['String']['output']>;
  pendingRuns?: Maybe<Scalars['Int']['output']>;
  raw?: Maybe<Scalars['String']['output']>;
  schema?: Maybe<Scalars['String']['output']>;
  status?: Maybe<EventStatus>;
  totalRuns?: Maybe<Scalars['Int']['output']>;
  workspace?: Maybe<Workspace>;
};

export type EventQuery = {
  eventId: Scalars['ID']['input'];
  workspaceId?: Scalars['ID']['input'];
};

export type EventSource = {
  __typename?: 'EventSource';
  id: Scalars['ID']['output'];
  name?: Maybe<Scalars['String']['output']>;
  sourceKind: Scalars['String']['output'];
};

export enum EventStatus {
  Completed = 'COMPLETED',
  Failed = 'FAILED',
  NoFunctions = 'NO_FUNCTIONS',
  PartiallyFailed = 'PARTIALLY_FAILED',
  Paused = 'PAUSED',
  Running = 'RUNNING',
}

export type EventV2 = {
  __typename?: 'EventV2';
  envID: Scalars['UUID']['output'];
  id: Scalars['ULID']['output'];
  idempotencyKey?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  occurredAt: Scalars['Time']['output'];
  raw: Scalars['String']['output'];
  receivedAt: Scalars['Time']['output'];
  runs: Array<FunctionRunV2>;
  source?: Maybe<EventSource>;
  version?: Maybe<Scalars['String']['output']>;
};

export type EventsBatchConfiguration = {
  __typename?: 'EventsBatchConfiguration';
  key?: Maybe<Scalars['String']['output']>;
  /** The maximum number of events a batch can have. */
  maxSize: Scalars['Int']['output'];
  /** How long to wait before running the function with the batch. */
  timeout: Scalars['String']['output'];
};

export type EventsConnection = {
  __typename?: 'EventsConnection';
  edges: Array<EventsEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type EventsEdge = {
  __typename?: 'EventsEdge';
  cursor: Scalars['String']['output'];
  node: EventV2;
};

export type EventsFilter = {
  eventNames?: InputMaybe<Array<Scalars['String']['input']>>;
  from: Scalars['Time']['input'];
  includeInternalEvents?: Scalars['Boolean']['input'];
  query?: InputMaybe<Scalars['String']['input']>;
  until?: InputMaybe<Scalars['Time']['input']>;
};

export type EventsQuery = {
  lastEventId?: InputMaybe<Scalars['ID']['input']>;
  workspaceId?: Scalars['ID']['input'];
};

export type Function = {
  __typename?: 'Function';
  app: App;
  appID: Scalars['String']['output'];
  concurrency: Scalars['Int']['output'];
  config: Scalars['String']['output'];
  configuration: FunctionConfiguration;
  failureHandler?: Maybe<Function>;
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
  slug: Scalars['String']['output'];
  triggers?: Maybe<Array<FunctionTrigger>>;
  url: Scalars['String']['output'];
};

export type FunctionConfiguration = {
  __typename?: 'FunctionConfiguration';
  cancellations: Array<CancellationConfiguration>;
  concurrency: Array<ConcurrencyConfiguration>;
  debounce?: Maybe<DebounceConfiguration>;
  eventsBatch?: Maybe<EventsBatchConfiguration>;
  priority?: Maybe<Scalars['String']['output']>;
  rateLimit?: Maybe<RateLimitConfiguration>;
  retries: RetryConfiguration;
  singleton?: Maybe<SingletonConfiguration>;
  throttle?: Maybe<ThrottleConfiguration>;
};

export type FunctionEvent = {
  __typename?: 'FunctionEvent';
  createdAt?: Maybe<Scalars['Time']['output']>;
  functionRun?: Maybe<FunctionRun>;
  output?: Maybe<Scalars['String']['output']>;
  type?: Maybe<FunctionEventType>;
  workspace?: Maybe<Workspace>;
};

export enum FunctionEventType {
  Cancelled = 'CANCELLED',
  Completed = 'COMPLETED',
  Failed = 'FAILED',
  Started = 'STARTED',
}

export type FunctionQuery = {
  functionSlug: Scalars['String']['input'];
  workspaceId?: Scalars['ID']['input'];
};

export type FunctionRun = {
  __typename?: 'FunctionRun';
  batchCreatedAt?: Maybe<Scalars['Time']['output']>;
  batchID?: Maybe<Scalars['ULID']['output']>;
  cron?: Maybe<Scalars['String']['output']>;
  event?: Maybe<Event>;
  eventID: Scalars['ID']['output'];
  events: Array<Event>;
  finishedAt?: Maybe<Scalars['Time']['output']>;
  function?: Maybe<Function>;
  functionID: Scalars['String']['output'];
  history: Array<RunHistoryItem>;
  historyItemOutput?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  output?: Maybe<Scalars['String']['output']>;
  pendingSteps?: Maybe<Scalars['Int']['output']>;
  startedAt?: Maybe<Scalars['Time']['output']>;
  status?: Maybe<FunctionRunStatus>;
  waitingFor?: Maybe<StepEventWait>;
  workspace?: Maybe<Workspace>;
};

export type FunctionRunHistoryItemOutputArgs = {
  id: Scalars['ULID']['input'];
};

export type FunctionRunEvent = FunctionEvent | StepEvent;

export type FunctionRunQuery = {
  functionRunId: Scalars['ID']['input'];
  workspaceId?: Scalars['ID']['input'];
};

export enum FunctionRunStatus {
  Cancelled = 'CANCELLED',
  Completed = 'COMPLETED',
  Failed = 'FAILED',
  Queued = 'QUEUED',
  Running = 'RUNNING',
}

export type FunctionRunV2 = {
  __typename?: 'FunctionRunV2';
  app: App;
  appID: Scalars['UUID']['output'];
  batchCreatedAt?: Maybe<Scalars['Time']['output']>;
  cronSchedule?: Maybe<Scalars['String']['output']>;
  endedAt?: Maybe<Scalars['Time']['output']>;
  eventName?: Maybe<Scalars['String']['output']>;
  function: Function;
  functionID: Scalars['UUID']['output'];
  hasAI: Scalars['Boolean']['output'];
  id: Scalars['ULID']['output'];
  isBatch: Scalars['Boolean']['output'];
  output?: Maybe<Scalars['Bytes']['output']>;
  queuedAt: Scalars['Time']['output'];
  sourceID?: Maybe<Scalars['String']['output']>;
  startedAt?: Maybe<Scalars['Time']['output']>;
  status: FunctionRunStatus;
  trace?: Maybe<RunTraceSpan>;
  traceID: Scalars['String']['output'];
  triggerIDs: Array<Scalars['ULID']['output']>;
};

export type FunctionRunV2TraceArgs = {
  preview?: InputMaybe<Scalars['Boolean']['input']>;
};

export type FunctionRunV2Edge = {
  __typename?: 'FunctionRunV2Edge';
  cursor: Scalars['String']['output'];
  node: FunctionRunV2;
};

export type FunctionRunsQuery = {
  workspaceId?: Scalars['ID']['input'];
};

export enum FunctionStatus {
  Cancelled = 'CANCELLED',
  Completed = 'COMPLETED',
  Failed = 'FAILED',
  Running = 'RUNNING',
}

export type FunctionTrigger = {
  __typename?: 'FunctionTrigger';
  condition?: Maybe<Scalars['String']['output']>;
  type: FunctionTriggerTypes;
  value: Scalars['String']['output'];
};

export enum FunctionTriggerTypes {
  Cron = 'CRON',
  Event = 'EVENT',
}

export type FunctionVersion = {
  __typename?: 'FunctionVersion';
  config: Scalars['String']['output'];
  createdAt: Scalars['Time']['output'];
  functionId: Scalars['ID']['output'];
  updatedAt: Scalars['Time']['output'];
  validFrom?: Maybe<Scalars['Time']['output']>;
  validTo?: Maybe<Scalars['Time']['output']>;
  version: Scalars['Uint']['output'];
};

export enum HistoryStepType {
  Run = 'Run',
  Send = 'Send',
  Sleep = 'Sleep',
  Wait = 'Wait',
}

export enum HistoryType {
  FunctionCancelled = 'FunctionCancelled',
  FunctionCompleted = 'FunctionCompleted',
  FunctionFailed = 'FunctionFailed',
  FunctionScheduled = 'FunctionScheduled',
  FunctionStarted = 'FunctionStarted',
  FunctionStatusUpdated = 'FunctionStatusUpdated',
  None = 'None',
  StepCompleted = 'StepCompleted',
  StepErrored = 'StepErrored',
  StepFailed = 'StepFailed',
  StepScheduled = 'StepScheduled',
  StepSleeping = 'StepSleeping',
  StepStarted = 'StepStarted',
  StepWaiting = 'StepWaiting',
}

export type InvokeStepInfo = {
  __typename?: 'InvokeStepInfo';
  functionID: Scalars['String']['output'];
  returnEventID?: Maybe<Scalars['ULID']['output']>;
  runID?: Maybe<Scalars['ULID']['output']>;
  timedOut?: Maybe<Scalars['Boolean']['output']>;
  timeout: Scalars['Time']['output'];
  triggeringEventID: Scalars['ULID']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  cancelRun: FunctionRun;
  createApp: App;
  createDebugSession: CreateDebugSessionResponse;
  deleteApp: Scalars['String']['output'];
  deleteAppByName: Scalars['Boolean']['output'];
  invokeFunction?: Maybe<Scalars['Boolean']['output']>;
  rerun: Scalars['ULID']['output'];
  updateApp: App;
};

export type MutationCancelRunArgs = {
  runID: Scalars['ULID']['input'];
};

export type MutationCreateAppArgs = {
  input: CreateAppInput;
};

export type MutationCreateDebugSessionArgs = {
  input: CreateDebugSessionInput;
};

export type MutationDeleteAppArgs = {
  id: Scalars['String']['input'];
};

export type MutationDeleteAppByNameArgs = {
  name: Scalars['String']['input'];
};

export type MutationInvokeFunctionArgs = {
  data?: InputMaybe<Scalars['Map']['input']>;
  debugRunID?: InputMaybe<Scalars['ULID']['input']>;
  debugSessionID?: InputMaybe<Scalars['ULID']['input']>;
  functionSlug: Scalars['String']['input'];
  user?: InputMaybe<Scalars['Map']['input']>;
};

export type MutationRerunArgs = {
  debugRunID?: InputMaybe<Scalars['ULID']['input']>;
  debugSessionID?: InputMaybe<Scalars['ULID']['input']>;
  fromStep?: InputMaybe<RerunFromStepInput>;
  runID: Scalars['ULID']['input'];
};

export type MutationUpdateAppArgs = {
  input: UpdateAppInput;
};

/** The pagination information in a connection. */
export type PageInfo = {
  __typename?: 'PageInfo';
  /** When paginating forward, the cursor to query the next page. */
  endCursor?: Maybe<Scalars['String']['output']>;
  /** Indicates if there are any pages subsequent to the current page. */
  hasNextPage: Scalars['Boolean']['output'];
  /** Indicates if there are any pages prior to the current page. */
  hasPreviousPage: Scalars['Boolean']['output'];
  /** When paginating backward, the cursor to query the previous page. */
  startCursor?: Maybe<Scalars['String']['output']>;
};

export type Query = {
  __typename?: 'Query';
  app?: Maybe<App>;
  apps: Array<App>;
  debugRun?: Maybe<DebugRun>;
  debugSession?: Maybe<DebugSession>;
  event?: Maybe<Event>;
  eventV2: EventV2;
  events?: Maybe<Array<Event>>;
  eventsV2: EventsConnection;
  functionBySlug?: Maybe<Function>;
  functionRun?: Maybe<FunctionRun>;
  functions?: Maybe<Array<Function>>;
  run?: Maybe<FunctionRunV2>;
  runTrace: RunTraceSpan;
  runTraceSpanOutputByID: RunTraceSpanOutput;
  runTrigger: RunTraceTrigger;
  runs: RunsV2Connection;
  stream: Array<StreamItem>;
  workerConnection?: Maybe<ConnectV1WorkerConnection>;
  workerConnections: ConnectV1WorkerConnectionsConnection;
};

export type QueryAppArgs = {
  id: Scalars['UUID']['input'];
};

export type QueryAppsArgs = {
  filter?: InputMaybe<AppsFilterV1>;
};

export type QueryDebugRunArgs = {
  query: DebugRunQuery;
};

export type QueryDebugSessionArgs = {
  query: DebugSessionQuery;
};

export type QueryEventArgs = {
  query: EventQuery;
};

export type QueryEventV2Args = {
  id: Scalars['ULID']['input'];
};

export type QueryEventsArgs = {
  query: EventsQuery;
};

export type QueryEventsV2Args = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter: EventsFilter;
  first?: Scalars['Int']['input'];
};

export type QueryFunctionBySlugArgs = {
  query: FunctionQuery;
};

export type QueryFunctionRunArgs = {
  query: FunctionRunQuery;
};

export type QueryRunArgs = {
  runID: Scalars['String']['input'];
};

export type QueryRunTraceArgs = {
  runID: Scalars['String']['input'];
};

export type QueryRunTraceSpanOutputByIdArgs = {
  outputID: Scalars['String']['input'];
};

export type QueryRunTriggerArgs = {
  runID: Scalars['String']['input'];
};

export type QueryRunsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter: RunsFilterV2;
  first?: Scalars['Int']['input'];
  orderBy: Array<RunsV2OrderBy>;
  preview?: InputMaybe<Scalars['Boolean']['input']>;
};

export type QueryStreamArgs = {
  query: StreamQuery;
};

export type QueryWorkerConnectionArgs = {
  connectionId: Scalars['ULID']['input'];
};

export type QueryWorkerConnectionsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter: ConnectV1WorkerConnectionsFilter;
  first?: Scalars['Int']['input'];
  orderBy: Array<ConnectV1WorkerConnectionsOrderBy>;
};

export type RateLimitConfiguration = {
  __typename?: 'RateLimitConfiguration';
  key?: Maybe<Scalars['String']['output']>;
  limit: Scalars['Int']['output'];
  period: Scalars['String']['output'];
};

export type RerunFromStepInput = {
  input?: InputMaybe<Scalars['Bytes']['input']>;
  stepID: Scalars['String']['input'];
};

export type RetryConfiguration = {
  __typename?: 'RetryConfiguration';
  isDefault?: Maybe<Scalars['Boolean']['output']>;
  value: Scalars['Int']['output'];
};

export type RunHistoryCancel = {
  __typename?: 'RunHistoryCancel';
  eventID?: Maybe<Scalars['ULID']['output']>;
  expression?: Maybe<Scalars['String']['output']>;
  userID?: Maybe<Scalars['UUID']['output']>;
};

export type RunHistoryInvokeFunction = {
  __typename?: 'RunHistoryInvokeFunction';
  correlationID: Scalars['String']['output'];
  eventID: Scalars['ULID']['output'];
  functionID: Scalars['String']['output'];
  timeout: Scalars['Time']['output'];
};

export type RunHistoryInvokeFunctionResult = {
  __typename?: 'RunHistoryInvokeFunctionResult';
  eventID?: Maybe<Scalars['ULID']['output']>;
  runID?: Maybe<Scalars['ULID']['output']>;
  timeout: Scalars['Boolean']['output'];
};

export type RunHistoryItem = {
  __typename?: 'RunHistoryItem';
  attempt: Scalars['Int']['output'];
  cancel?: Maybe<RunHistoryCancel>;
  createdAt: Scalars['Time']['output'];
  functionVersion: Scalars['Int']['output'];
  groupID?: Maybe<Scalars['UUID']['output']>;
  id: Scalars['ULID']['output'];
  invokeFunction?: Maybe<RunHistoryInvokeFunction>;
  invokeFunctionResult?: Maybe<RunHistoryInvokeFunctionResult>;
  result?: Maybe<RunHistoryResult>;
  sleep?: Maybe<RunHistorySleep>;
  stepName?: Maybe<Scalars['String']['output']>;
  stepType?: Maybe<HistoryStepType>;
  type: HistoryType;
  url?: Maybe<Scalars['String']['output']>;
  waitForEvent?: Maybe<RunHistoryWaitForEvent>;
  waitResult?: Maybe<RunHistoryWaitResult>;
};

export type RunHistoryResult = {
  __typename?: 'RunHistoryResult';
  durationMS: Scalars['Int']['output'];
  errorCode?: Maybe<Scalars['String']['output']>;
  framework?: Maybe<Scalars['String']['output']>;
  platform?: Maybe<Scalars['String']['output']>;
  sdkLanguage: Scalars['String']['output'];
  sdkVersion: Scalars['String']['output'];
  sizeBytes: Scalars['Int']['output'];
};

export type RunHistorySleep = {
  __typename?: 'RunHistorySleep';
  until: Scalars['Time']['output'];
};

export type RunHistoryWaitForEvent = {
  __typename?: 'RunHistoryWaitForEvent';
  eventName: Scalars['String']['output'];
  expression?: Maybe<Scalars['String']['output']>;
  timeout: Scalars['Time']['output'];
};

export type RunHistoryWaitResult = {
  __typename?: 'RunHistoryWaitResult';
  eventID?: Maybe<Scalars['ULID']['output']>;
  timeout: Scalars['Boolean']['output'];
};

export type RunStep = {
  __typename?: 'RunStep';
  name: Scalars['String']['output'];
  stepID: Scalars['String']['output'];
  stepOp?: Maybe<StepOp>;
};

export type RunStepInfo = {
  __typename?: 'RunStepInfo';
  type?: Maybe<Scalars['String']['output']>;
};

export type RunTraceSpan = {
  __typename?: 'RunTraceSpan';
  appID: Scalars['UUID']['output'];
  attempts?: Maybe<Scalars['Int']['output']>;
  childrenSpans: Array<RunTraceSpan>;
  debugPaused: Scalars['Boolean']['output'];
  debugRunID?: Maybe<Scalars['ULID']['output']>;
  debugSessionID?: Maybe<Scalars['ULID']['output']>;
  duration?: Maybe<Scalars['Int']['output']>;
  endedAt?: Maybe<Scalars['Time']['output']>;
  functionID: Scalars['UUID']['output'];
  isRoot: Scalars['Boolean']['output'];
  isUserland: Scalars['Boolean']['output'];
  metadata: Array<SpanMetadata>;
  name: Scalars['String']['output'];
  outputID?: Maybe<Scalars['String']['output']>;
  parentSpan?: Maybe<RunTraceSpan>;
  parentSpanID?: Maybe<Scalars['String']['output']>;
  queuedAt: Scalars['Time']['output'];
  run: FunctionRun;
  runID: Scalars['ULID']['output'];
  spanID: Scalars['String']['output'];
  startedAt?: Maybe<Scalars['Time']['output']>;
  status: RunTraceSpanStatus;
  stepID?: Maybe<Scalars['String']['output']>;
  stepInfo?: Maybe<StepInfo>;
  stepOp?: Maybe<StepOp>;
  stepType: Scalars['String']['output'];
  traceID: Scalars['String']['output'];
  userlandSpan?: Maybe<UserlandSpan>;
};

export type RunTraceSpanOutput = {
  __typename?: 'RunTraceSpanOutput';
  data?: Maybe<Scalars['Bytes']['output']>;
  error?: Maybe<StepError>;
  input?: Maybe<Scalars['Bytes']['output']>;
};

export enum RunTraceSpanStatus {
  Cancelled = 'CANCELLED',
  Completed = 'COMPLETED',
  Failed = 'FAILED',
  Queued = 'QUEUED',
  Running = 'RUNNING',
  Waiting = 'WAITING',
}

export type RunTraceTrigger = {
  __typename?: 'RunTraceTrigger';
  IDs: Array<Scalars['ULID']['output']>;
  batchID?: Maybe<Scalars['ULID']['output']>;
  cron?: Maybe<Scalars['String']['output']>;
  eventName?: Maybe<Scalars['String']['output']>;
  isBatch: Scalars['Boolean']['output'];
  payloads: Array<Scalars['Bytes']['output']>;
  timestamp: Scalars['Time']['output'];
};

export type RunsFilterV2 = {
  appIDs?: InputMaybe<Array<Scalars['UUID']['input']>>;
  from: Scalars['Time']['input'];
  functionIDs?: InputMaybe<Array<Scalars['UUID']['input']>>;
  query?: InputMaybe<Scalars['String']['input']>;
  status?: InputMaybe<Array<FunctionRunStatus>>;
  timeField?: InputMaybe<RunsV2OrderByField>;
  until?: InputMaybe<Scalars['Time']['input']>;
};

export enum RunsOrderByDirection {
  Asc = 'ASC',
  Desc = 'DESC',
}

export type RunsV2Connection = {
  __typename?: 'RunsV2Connection';
  edges: Array<FunctionRunV2Edge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type RunsV2ConnectionTotalCountArgs = {
  preview?: InputMaybe<Scalars['Boolean']['input']>;
};

export type RunsV2OrderBy = {
  direction: RunsOrderByDirection;
  field: RunsV2OrderByField;
};

export enum RunsV2OrderByField {
  EndedAt = 'ENDED_AT',
  QueuedAt = 'QUEUED_AT',
  StartedAt = 'STARTED_AT',
}

export type SingletonConfiguration = {
  __typename?: 'SingletonConfiguration';
  key?: Maybe<Scalars['String']['output']>;
  mode: SingletonMode;
};

export enum SingletonMode {
  Cancel = 'CANCEL',
  Skip = 'SKIP',
}

export type SleepStepInfo = {
  __typename?: 'SleepStepInfo';
  sleepUntil: Scalars['Time']['output'];
};

export type SpanMetadata = {
  __typename?: 'SpanMetadata';
  kind: Scalars['SpanMetadataKind']['output'];
  scope: Scalars['SpanMetadataScope']['output'];
  updatedAt: Scalars['Time']['output'];
  values: Scalars['SpanMetadataValues']['output'];
};

export type StepError = {
  __typename?: 'StepError';
  cause?: Maybe<Scalars['Unknown']['output']>;
  message: Scalars['String']['output'];
  name?: Maybe<Scalars['String']['output']>;
  stack?: Maybe<Scalars['String']['output']>;
};

export type StepEvent = {
  __typename?: 'StepEvent';
  createdAt?: Maybe<Scalars['Time']['output']>;
  functionRun?: Maybe<FunctionRun>;
  name?: Maybe<Scalars['String']['output']>;
  output?: Maybe<Scalars['String']['output']>;
  stepID?: Maybe<Scalars['String']['output']>;
  type?: Maybe<StepEventType>;
  waitingFor?: Maybe<StepEventWait>;
  workspace?: Maybe<Workspace>;
};

export enum StepEventType {
  Completed = 'COMPLETED',
  Errored = 'ERRORED',
  Failed = 'FAILED',
  Scheduled = 'SCHEDULED',
  Started = 'STARTED',
  Waiting = 'WAITING',
}

export type StepEventWait = {
  __typename?: 'StepEventWait';
  eventName?: Maybe<Scalars['String']['output']>;
  expiryTime: Scalars['Time']['output'];
  expression?: Maybe<Scalars['String']['output']>;
};

export type StepInfo =
  | InvokeStepInfo
  | RunStepInfo
  | SleepStepInfo
  | WaitForEventStepInfo
  | WaitForSignalStepInfo;

export enum StepOp {
  AiGateway = 'AI_GATEWAY',
  Invoke = 'INVOKE',
  Run = 'RUN',
  Sleep = 'SLEEP',
  WaitForEvent = 'WAIT_FOR_EVENT',
  WaitForSignal = 'WAIT_FOR_SIGNAL',
}

export type StreamItem = {
  __typename?: 'StreamItem';
  createdAt: Scalars['Time']['output'];
  id: Scalars['ID']['output'];
  inBatch: Scalars['Boolean']['output'];
  runs?: Maybe<Array<Maybe<FunctionRun>>>;
  trigger: Scalars['String']['output'];
  type: StreamType;
};

export type StreamQuery = {
  after?: InputMaybe<Scalars['ID']['input']>;
  before?: InputMaybe<Scalars['ID']['input']>;
  includeInternalEvents?: InputMaybe<Scalars['Boolean']['input']>;
  limit?: Scalars['Int']['input'];
};

export enum StreamType {
  Cron = 'CRON',
  Event = 'EVENT',
}

export type ThrottleConfiguration = {
  __typename?: 'ThrottleConfiguration';
  burst: Scalars['Int']['output'];
  key?: Maybe<Scalars['String']['output']>;
  limit: Scalars['Int']['output'];
  period: Scalars['String']['output'];
};

export type UpdateAppInput = {
  id: Scalars['String']['input'];
  url: Scalars['String']['input'];
};

export type UserlandSpan = {
  __typename?: 'UserlandSpan';
  resourceAttrs?: Maybe<Scalars['Bytes']['output']>;
  scopeName?: Maybe<Scalars['String']['output']>;
  scopeVersion?: Maybe<Scalars['String']['output']>;
  serviceName?: Maybe<Scalars['String']['output']>;
  spanAttrs?: Maybe<Scalars['Bytes']['output']>;
  spanKind?: Maybe<Scalars['String']['output']>;
  spanName?: Maybe<Scalars['String']['output']>;
};

export type WaitForEventStepInfo = {
  __typename?: 'WaitForEventStepInfo';
  eventName: Scalars['String']['output'];
  expression?: Maybe<Scalars['String']['output']>;
  foundEventID?: Maybe<Scalars['ULID']['output']>;
  timedOut?: Maybe<Scalars['Boolean']['output']>;
  timeout: Scalars['Time']['output'];
};

export type WaitForSignalStepInfo = {
  __typename?: 'WaitForSignalStepInfo';
  signal: Scalars['String']['output'];
  timedOut?: Maybe<Scalars['Boolean']['output']>;
  timeout: Scalars['Time']['output'];
};

export type Workspace = {
  __typename?: 'Workspace';
  id: Scalars['ID']['output'];
};

export type GetRunsQueryVariables = Exact<{
  appIDs?: InputMaybe<Array<Scalars['UUID']['input']> | Scalars['UUID']['input']>;
  startTime: Scalars['Time']['input'];
  status?: InputMaybe<Array<FunctionRunStatus> | FunctionRunStatus>;
  timeField: RunsV2OrderByField;
  functionRunCursor?: InputMaybe<Scalars['String']['input']>;
  celQuery?: InputMaybe<Scalars['String']['input']>;
  preview?: InputMaybe<Scalars['Boolean']['input']>;
}>;

export type GetRunsQuery = {
  __typename?: 'Query';
  runs: {
    __typename?: 'RunsV2Connection';
    edges: Array<{
      __typename?: 'FunctionRunV2Edge';
      node: {
        __typename?: 'FunctionRunV2';
        id: any;
        queuedAt: any;
        endedAt?: any | null;
        startedAt?: any | null;
        status: FunctionRunStatus;
      };
    }>;
    pageInfo: {
      __typename?: 'PageInfo';
      hasNextPage: boolean;
      hasPreviousPage: boolean;
      startCursor?: string | null;
      endCursor?: string | null;
    };
  };
};

export type TraceDetailsFragment = {
  __typename?: 'RunTraceSpan';
  name: string;
  status: RunTraceSpanStatus;
  attempts?: number | null;
  queuedAt: any;
  startedAt?: any | null;
  endedAt?: any | null;
  outputID?: string | null;
};

export type GetRunQueryVariables = Exact<{
  runID: Scalars['String']['input'];
  preview?: InputMaybe<Scalars['Boolean']['input']>;
}>;

export type GetRunQuery = {
  __typename?: 'Query';
  run?: {
    __typename?: 'FunctionRunV2';
    status: FunctionRunStatus;
    trace?: {
      __typename?: 'RunTraceSpan';
      name: string;
      status: RunTraceSpanStatus;
      attempts?: number | null;
      queuedAt: any;
      startedAt?: any | null;
      endedAt?: any | null;
      outputID?: string | null;
      childrenSpans: Array<{
        __typename?: 'RunTraceSpan';
        name: string;
        status: RunTraceSpanStatus;
        attempts?: number | null;
        queuedAt: any;
        startedAt?: any | null;
        endedAt?: any | null;
        outputID?: string | null;
        childrenSpans: Array<{
          __typename?: 'RunTraceSpan';
          name: string;
          status: RunTraceSpanStatus;
          attempts?: number | null;
          queuedAt: any;
          startedAt?: any | null;
          endedAt?: any | null;
          outputID?: string | null;
        }>;
      }>;
    } | null;
  } | null;
};

export type GetTraceResultQueryVariables = Exact<{
  traceID: Scalars['String']['input'];
}>;

export type GetTraceResultQuery = {
  __typename?: 'Query';
  runTraceSpanOutputByID: {
    __typename?: 'RunTraceSpanOutput';
    input?: any | null;
    data?: any | null;
    error?: {
      __typename?: 'StepError';
      message: string;
      name?: string | null;
      stack?: string | null;
      cause?: any | null;
    } | null;
  };
};

export type GetEventV2PayloadQueryVariables = Exact<{
  eventID: Scalars['ULID']['input'];
}>;

export type GetEventV2PayloadQuery = {
  __typename?: 'Query';
  eventV2: { __typename?: 'EventV2'; raw: string };
};

export type GetEventWithRunsQueryVariables = Exact<{
  eventID: Scalars['ULID']['input'];
}>;

export type GetEventWithRunsQuery = {
  __typename?: 'Query';
  eventV2: {
    __typename?: 'EventV2';
    name: string;
    id: any;
    receivedAt: any;
    idempotencyKey?: string | null;
    occurredAt: any;
    version?: string | null;
    source?: { __typename?: 'EventSource'; name?: string | null } | null;
    runs: Array<{
      __typename?: 'FunctionRunV2';
      status: FunctionRunStatus;
      id: any;
      startedAt?: any | null;
      endedAt?: any | null;
      function: { __typename?: 'Function'; name: string; slug: string };
    }>;
  };
};

export const TraceDetailsFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'TraceDetails' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'RunTraceSpan' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'status' } },
          { kind: 'Field', name: { kind: 'Name', value: 'attempts' } },
          { kind: 'Field', name: { kind: 'Name', value: 'queuedAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'startedAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'endedAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'outputID' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<TraceDetailsFragment, unknown>;
export const GetRunsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'GetRuns' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'appIDs' } },
          type: {
            kind: 'ListType',
            type: {
              kind: 'NonNullType',
              type: { kind: 'NamedType', name: { kind: 'Name', value: 'UUID' } },
            },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'startTime' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'Time' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'status' } },
          type: {
            kind: 'ListType',
            type: {
              kind: 'NonNullType',
              type: { kind: 'NamedType', name: { kind: 'Name', value: 'FunctionRunStatus' } },
            },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'timeField' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'RunsV2OrderByField' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'functionRunCursor' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
          defaultValue: { kind: 'NullValue' },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'celQuery' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
          defaultValue: { kind: 'NullValue' },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'preview' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'Boolean' } },
          defaultValue: { kind: 'BooleanValue', value: false },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'runs' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'filter' },
                value: {
                  kind: 'ObjectValue',
                  fields: [
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'appIDs' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'appIDs' } },
                    },
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'from' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'startTime' } },
                    },
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'status' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'status' } },
                    },
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'timeField' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'timeField' } },
                    },
                    {
                      kind: 'ObjectField',
                      name: { kind: 'Name', value: 'query' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'celQuery' } },
                    },
                  ],
                },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'orderBy' },
                value: {
                  kind: 'ListValue',
                  values: [
                    {
                      kind: 'ObjectValue',
                      fields: [
                        {
                          kind: 'ObjectField',
                          name: { kind: 'Name', value: 'field' },
                          value: { kind: 'Variable', name: { kind: 'Name', value: 'timeField' } },
                        },
                        {
                          kind: 'ObjectField',
                          name: { kind: 'Name', value: 'direction' },
                          value: { kind: 'EnumValue', value: 'DESC' },
                        },
                      ],
                    },
                  ],
                },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'after' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'functionRunCursor' } },
              },
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'preview' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'preview' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'edges' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'node' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'queuedAt' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'endedAt' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'startedAt' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'status' } },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'pageInfo' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'hasNextPage' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'hasPreviousPage' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'startCursor' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'endCursor' } },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<GetRunsQuery, GetRunsQueryVariables>;
export const GetRunDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'GetRun' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'runID' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
          },
        },
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'preview' } },
          type: { kind: 'NamedType', name: { kind: 'Name', value: 'Boolean' } },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'run' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'runID' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'runID' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'status' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'trace' },
                  arguments: [
                    {
                      kind: 'Argument',
                      name: { kind: 'Name', value: 'preview' },
                      value: { kind: 'Variable', name: { kind: 'Name', value: 'preview' } },
                    },
                  ],
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'FragmentSpread', name: { kind: 'Name', value: 'TraceDetails' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'childrenSpans' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            {
                              kind: 'FragmentSpread',
                              name: { kind: 'Name', value: 'TraceDetails' },
                            },
                            {
                              kind: 'Field',
                              name: { kind: 'Name', value: 'childrenSpans' },
                              selectionSet: {
                                kind: 'SelectionSet',
                                selections: [
                                  {
                                    kind: 'FragmentSpread',
                                    name: { kind: 'Name', value: 'TraceDetails' },
                                  },
                                ],
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'TraceDetails' },
      typeCondition: { kind: 'NamedType', name: { kind: 'Name', value: 'RunTraceSpan' } },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          { kind: 'Field', name: { kind: 'Name', value: 'status' } },
          { kind: 'Field', name: { kind: 'Name', value: 'attempts' } },
          { kind: 'Field', name: { kind: 'Name', value: 'queuedAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'startedAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'endedAt' } },
          { kind: 'Field', name: { kind: 'Name', value: 'outputID' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<GetRunQuery, GetRunQueryVariables>;
export const GetTraceResultDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'GetTraceResult' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'traceID' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'runTraceSpanOutputByID' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'outputID' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'traceID' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'input' } },
                { kind: 'Field', name: { kind: 'Name', value: 'data' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'error' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'message' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'stack' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'cause' } },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<GetTraceResultQuery, GetTraceResultQueryVariables>;
export const GetEventV2PayloadDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'GetEventV2Payload' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'eventID' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'ULID' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'eventV2' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'id' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'eventID' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [{ kind: 'Field', name: { kind: 'Name', value: 'raw' } }],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<GetEventV2PayloadQuery, GetEventV2PayloadQueryVariables>;
export const GetEventWithRunsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'GetEventWithRuns' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'eventID' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'ULID' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'eventV2' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'id' },
                value: { kind: 'Variable', name: { kind: 'Name', value: 'eventID' } },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'receivedAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'idempotencyKey' } },
                { kind: 'Field', name: { kind: 'Name', value: 'occurredAt' } },
                { kind: 'Field', name: { kind: 'Name', value: 'version' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'source' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [{ kind: 'Field', name: { kind: 'Name', value: 'name' } }],
                  },
                },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'runs' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      { kind: 'Field', name: { kind: 'Name', value: 'status' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'startedAt' } },
                      { kind: 'Field', name: { kind: 'Name', value: 'endedAt' } },
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'function' },
                        selectionSet: {
                          kind: 'SelectionSet',
                          selections: [
                            { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                            { kind: 'Field', name: { kind: 'Name', value: 'slug' } },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<GetEventWithRunsQuery, GetEventWithRunsQueryVariables>;
