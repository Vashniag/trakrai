import { gql } from 'graphql-request';

export const GetRunsDocument = gql`
  query GetRuns(
    $appIDs: [UUID!]
    $startTime: Time!
    $status: [FunctionRunStatus!]
    $timeField: RunsV2OrderByField!
    $functionRunCursor: String = null
    $celQuery: String = null
    $preview: Boolean = false
  ) {
    runs(
      filter: {
        appIDs: $appIDs
        from: $startTime
        status: $status
        timeField: $timeField
        query: $celQuery
      }
      orderBy: [{ field: $timeField, direction: DESC }]
      after: $functionRunCursor
      preview: $preview
    ) {
      edges {
        node {
          id
          queuedAt
          endedAt
          startedAt
          status
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

export const GetRunDocument = gql`
  fragment TraceDetails on RunTraceSpan {
    name
    status
    attempts
    queuedAt
    startedAt
    endedAt
    outputID
  }

  query GetRun($runID: String!, $preview: Boolean) {
    run(runID: $runID) {
      status
      trace(preview: $preview) {
        ...TraceDetails
        childrenSpans {
          ...TraceDetails
          childrenSpans {
            ...TraceDetails
          }
        }
      }
    }
  }
`;

export const GetTraceResultDocument = gql`
  query GetTraceResult($traceID: String!) {
    runTraceSpanOutputByID(outputID: $traceID) {
      input
      data
      error {
        message
        name
        stack
        cause
      }
    }
  }
`;

export const GetEventV2PayloadDocument = gql`
  query GetEventV2Payload($eventID: ULID!) {
    eventV2(id: $eventID) {
      raw
    }
  }
`;

export const GetEventWithRunsDocument = gql`
  query GetEventWithRuns($eventID: ULID!) {
    eventV2(id: $eventID) {
      name
      id
      receivedAt
      idempotencyKey
      occurredAt
      version
      source {
        name
      }
      runs {
        status
        id
        startedAt
        endedAt
        function {
          name
          slug
        }
      }
    }
  }
`;
