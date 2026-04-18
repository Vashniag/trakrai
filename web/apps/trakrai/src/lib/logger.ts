import { requestContextStorage } from '@trakrai/backend/lib/request-context';
import * as winston from 'winston';

const injectRequestContext = winston.format((info) => {
  const ctx = requestContextStorage.getStore();
  if (ctx !== undefined) {
    info.requestId = ctx.requestId;
    info.method = ctx.method;
    info.path = ctx.path;
  }
  return info;
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    injectRequestContext(),
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: 'trakrai' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        injectRequestContext(),
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(
          ({ timestamp, level, message, service, requestId, method, path, ...meta }) => {
            const reqStr =
              requestId !== undefined
                ? ` [${String(method)} ${String(path)} req:${String(requestId)}]`
                : '';
            const metaStr =
              Object.keys(meta).length > 0 ? `\n${JSON.stringify(meta, null, 2)}` : '';
            return `${String(timestamp)} [${String(service)}]${reqStr} ${String(level)}: ${String(message)}${metaStr}`;
          },
        ),
      ),
    }),
  ],
});

export default logger;
