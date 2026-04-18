import { type Server } from 'node:http';

import express from 'express';
import { createOpenApiExpressMiddleware, generateOpenApiDocument } from 'trpc-to-openapi';

import { schedulerRouter } from './api/router';
import { env } from './env';
import logger from './logger';

const OPEN_API_PATH = '/openapi.json';
const API_BASE_PATH = '/api';

export const startHttpServer = async (): Promise<Server> => {
  const app = express();

  app.disable('x-powered-by');

  app.get(OPEN_API_PATH, (_req, res) => {
    const openApiDocument = generateOpenApiDocument(schedulerRouter, {
      title: 'Flow Scheduler API',
      version: '1.0.0',
      baseUrl: `http://localhost:${String(env.SCHEDULER_PORT)}${API_BASE_PATH}`,
    });
    res.json(openApiDocument);
  });

  app.use(
    API_BASE_PATH,
    createOpenApiExpressMiddleware({
      router: schedulerRouter,
      createContext: () => ({}),
    }),
  );

  return new Promise<Server>((resolve, reject) => {
    const server = app.listen(env.SCHEDULER_PORT, env.SCHEDULER_HOST, () => {
      logger.info('Scheduler HTTP server is listening', {
        host: env.SCHEDULER_HOST,
        port: env.SCHEDULER_PORT,
        openApiPath: OPEN_API_PATH,
      });
      resolve(server);
    });

    server.once('error', reject);
  });
};

export const closeHttpServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};
