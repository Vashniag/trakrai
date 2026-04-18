import { Queue, QueueEvents, Worker } from 'bullmq';

import { env } from './env';
import logger from './logger';

import type { CronFlowTrigger, FlowJobData } from './types';

const QUEUE_NAME = 'flow-scheduler-jobs';
const MAX_JOB_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;
const RETAIN_COMPLETED_JOB_COUNT = 100;
const RETAIN_COMPLETED_JOB_AGE_SECONDS = 24 * 3600;
const RETAIN_FAILED_JOB_COUNT = 500;

const queueConnection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
};

const schedulerQueue = new Queue<FlowJobData>(QUEUE_NAME, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: MAX_JOB_ATTEMPTS,
    backoff: {
      delay: RETRY_DELAY_MS,
      type: 'exponential',
    },
    removeOnComplete: {
      age: RETAIN_COMPLETED_JOB_AGE_SECONDS,
      count: RETAIN_COMPLETED_JOB_COUNT,
    },
    removeOnFail: {
      count: RETAIN_FAILED_JOB_COUNT,
    },
  },
});

const schedulerQueueEvents = new QueueEvents(QUEUE_NAME, {
  connection: queueConnection,
});

const schedulerWorker = new Worker<FlowJobData>(
  QUEUE_NAME,
  async (job) => {
    logger.info('Processing scheduled flow trigger job', {
      cronTriggerId: job.data.cronTriggerId,
      flowId: job.data.flowId,
      jobId: job.id,
      nodeId: job.data.nodeId,
    });

    const response = await fetch(env.CRON_TRIGGER_URL, {
      body: JSON.stringify({
        cronTriggerId: job.data.cronTriggerId,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: AbortSignal.timeout(env.SCHEDULER_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorBody = await response.text();

      throw new Error(
        `Workflow trigger request failed with status ${String(response.status)}: ${errorBody}`,
      );
    }

    const responsePayload: unknown = await response.json();

    logger.info('Scheduled flow trigger job completed', {
      cronTriggerId: job.data.cronTriggerId,
      flowId: job.data.flowId,
      jobId: job.id,
      nodeId: job.data.nodeId,
      response: responsePayload,
    });

    return responsePayload;
  },
  {
    concurrency: env.SCHEDULER_WORKER_CONCURRENCY,
    connection: queueConnection,
  },
);

schedulerWorker.on('completed', (job) => {
  logger.info('Flow trigger job marked complete', {
    jobId: job.id,
  });
});

schedulerWorker.on('failed', (job, error) => {
  logger.error('Flow trigger job failed', {
    cronTriggerId: job?.data.cronTriggerId,
    error: error.message,
    flowId: job?.data.flowId,
    jobId: job?.id,
    nodeId: job?.data.nodeId,
  });
});

schedulerQueueEvents.on('active', ({ jobId }) => {
  logger.info('Flow trigger job is active', {
    jobId,
  });
});

schedulerQueueEvents.on('waiting', ({ jobId }) => {
  logger.info('Flow trigger job is waiting', {
    jobId,
  });
});

export const upsertScheduledCronTrigger = async (trigger: CronFlowTrigger): Promise<void> => {
  await schedulerQueue.upsertJobScheduler(
    trigger.cronTriggerId,
    {
      pattern: trigger.cronExpression,
    },
    {
      data: {
        cronTriggerId: trigger.cronTriggerId,
        flowId: trigger.flowId,
        nodeId: trigger.nodeId,
      },
      name: `cron:${trigger.nodeId}`,
    },
  );

  logger.info('Scheduled cron trigger upserted in Redis', {
    cronTriggerId: trigger.cronTriggerId,
    cronExpression: trigger.cronExpression,
    flowId: trigger.flowId,
    nodeId: trigger.nodeId,
  });
};

export const removeScheduledCronTrigger = async (cronTriggerId: string): Promise<void> => {
  const wasRemoved = await schedulerQueue.removeJobScheduler(cronTriggerId);

  logger.info('Removed cron trigger scheduler from Redis', {
    cronTriggerId,
    removed: wasRemoved,
  });
};

export const listScheduledCronTriggerIds = async (): Promise<string[]> => {
  const schedulers = await schedulerQueue.getJobSchedulers(0, -1, true);

  return schedulers.flatMap((scheduler) => {
    const schedulerId = [Reflect.get(scheduler, 'id'), Reflect.get(scheduler, 'key')].find(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );

    if (schedulerId === undefined) {
      logger.warn('Scheduler entry without id found; it cannot be reconciled automatically', {
        schedulerKey: scheduler.key,
      });
      return [];
    }

    return [schedulerId];
  });
};

export const closeQueueResources = async (): Promise<void> => {
  logger.info('Closing queue resources');

  await schedulerWorker.close();
  await schedulerQueue.close();
  await schedulerQueueEvents.close();

  logger.info('Queue resources closed');
};
