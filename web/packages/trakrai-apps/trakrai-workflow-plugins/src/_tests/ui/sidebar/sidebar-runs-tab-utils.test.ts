import { describe, expect, it } from 'vitest';

import { FunctionRunStatus } from '../../../runs/inngest-graphql/graphql';
import {
  getRunStatusVariant,
  getWorkflowDataOutputId,
  hasRunningOrQueuedRuns,
  parseWorkflowData,
} from '../../../runs/sidebar-runs-tab-utils';

describe('sidebar-runs-tab-utils', () => {
  it('maps run statuses to badge variants', () => {
    expect(getRunStatusVariant(FunctionRunStatus.Completed)).toBe('default');
    expect(getRunStatusVariant(FunctionRunStatus.Running)).toBe('secondary');
    expect(getRunStatusVariant(FunctionRunStatus.Failed)).toBe('destructive');
  });

  it('parses workflow data only when shape is valid', () => {
    expect(parseWorkflowData(undefined)).toBeUndefined();
    expect(parseWorkflowData('{"invalid":true}')).toBeUndefined();
    expect(parseWorkflowData('{')).toBeUndefined();

    expect(parseWorkflowData('{"nodes":[],"edges":[]}')).toEqual({
      nodes: [],
      edges: [],
    });
  });

  it('extracts workflow output id from run data trace', () => {
    const runData = {
      trace: {
        childrenSpans: [{ name: 'ignore' }, { name: 'get-workflow', outputID: 'out-123' }],
      },
    };

    expect(getWorkflowDataOutputId(runData as never)).toBe('out-123');
    expect(getWorkflowDataOutputId(undefined)).toBeNull();
  });

  it('detects if any run is running or queued', () => {
    expect(hasRunningOrQueuedRuns(undefined)).toBe(false);
    expect(
      hasRunningOrQueuedRuns([
        { status: FunctionRunStatus.Completed },
        { status: FunctionRunStatus.Failed },
      ]),
    ).toBe(false);
    expect(
      hasRunningOrQueuedRuns([
        { status: FunctionRunStatus.Completed },
        { status: FunctionRunStatus.Queued },
      ]),
    ).toBe(true);
  });
});
