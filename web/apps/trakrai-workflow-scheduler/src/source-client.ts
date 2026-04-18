import { z } from 'zod';

import { env } from './env';

import type { CronFlowTrigger } from './types';

const activeCronTriggerSchema = z.object({
  cronExpression: z.string().min(1),
  cronTriggerId: z.string().min(1),
  flowId: z.string().uuid(),
  nodeId: z.string().uuid(),
});

const activeCronTriggersSchema = z.array(activeCronTriggerSchema);

export const listActiveCronTriggersFromWebApp = async (): Promise<CronFlowTrigger[]> => {
  const response = await fetch(env.ACTIVE_CRONS_URL, {
    method: 'GET',
    signal: AbortSignal.timeout(env.SCHEDULER_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Failed to fetch active cron triggers with status ${String(response.status)}: ${errorBody}`,
    );
  }

  const responsePayload: unknown = await response.json();
  const parsed = activeCronTriggersSchema.safeParse(responsePayload);

  if (!parsed.success) {
    throw new Error(`Invalid active cron trigger response: ${parsed.error.message}`);
  }

  return parsed.data;
};
