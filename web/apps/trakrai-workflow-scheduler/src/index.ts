import { env } from './env';
import { closeHttpServer, startHttpServer } from './http-server';
import logger from './logger';
import { closeQueueResources } from './queue';
import { reconcileCronTriggers } from './reconciler';

const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;

const startService = async (): Promise<void> => {
  logger.info('Flow scheduler service starting', {
    environment: env.NODE_ENV,
    redisHost: env.REDIS_HOST,
    redisPort: env.REDIS_PORT,
    schedulerHost: env.SCHEDULER_HOST,
    schedulerPort: env.SCHEDULER_PORT,
    webAppBaseUrl: env.WEB_APP_BASE_URL,
  });

  const server = await startHttpServer();

  try {
    await reconcileCronTriggers();
  } catch (error) {
    logger.error('Initial cron trigger reconciliation failed; continuing startup', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const reconcileInterval = setInterval(() => {
    void reconcileCronTriggers().catch((error: unknown) => {
      logger.error('Periodic cron trigger reconciliation failed', {
        error: (error as Error).message,
      });
    });
  }, env.SCHEDULER_RECONCILE_INTERVAL_MS);

  reconcileInterval.unref();

  let shuttingDown = false;

  const shutdown = async (signal: string, exitCode: number): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    clearInterval(reconcileInterval);

    logger.info('Flow scheduler service shutting down', {
      signal,
    });

    try {
      await closeHttpServer(server);
      await closeQueueResources();

      logger.info('Flow scheduler service stopped cleanly');
      process.exit(exitCode);
    } catch (error) {
      logger.error('Error during shutdown', {
        error: (error as Error).message,
        signal,
      });
      process.exit(EXIT_FAILURE);
    }
  };

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM', EXIT_SUCCESS);
  });

  process.once('SIGINT', () => {
    void shutdown('SIGINT', EXIT_SUCCESS);
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', {
      error: error.message,
      stack: error.stack,
    });
    void shutdown('uncaughtException', EXIT_FAILURE);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', {
      reason,
    });
    void shutdown('unhandledRejection', EXIT_FAILURE);
  });

  logger.info('Flow scheduler service is running');
};

void startService().catch((error: unknown) => {
  logger.error('Failed to start flow scheduler service', {
    error: (error as Error).message,
  });
  process.exit(EXIT_FAILURE);
});
