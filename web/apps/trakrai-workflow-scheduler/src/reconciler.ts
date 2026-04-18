import logger from './logger';
import {
  listScheduledCronTriggerIds,
  removeScheduledCronTrigger,
  upsertScheduledCronTrigger,
} from './queue';
import { listActiveCronTriggersFromWebApp } from './source-client';

export const reconcileCronTriggers = async (): Promise<void> => {
  logger.info('Starting cron trigger reconciliation');

  const [activeCronTriggers, scheduledTriggerIds] = await Promise.all([
    listActiveCronTriggersFromWebApp(),
    listScheduledCronTriggerIds(),
  ]);

  const activeTriggerIds = new Set(activeCronTriggers.map((trigger) => trigger.cronTriggerId));

  let staleSchedulerCount = 0;

  for (const scheduledTriggerId of scheduledTriggerIds) {
    if (activeTriggerIds.has(scheduledTriggerId)) {
      continue;
    }

    staleSchedulerCount += 1;
    await removeScheduledCronTrigger(scheduledTriggerId);
  }

  for (const trigger of activeCronTriggers) {
    await upsertScheduledCronTrigger(trigger);
  }

  logger.info('Cron trigger reconciliation completed', {
    activeCronTriggerCount: activeCronTriggers.length,
    staleSchedulerCount,
  });
};
