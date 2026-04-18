import { createLogger, format, transports } from 'winston';

import { env } from './env';

const logger = createLogger({
  defaultMeta: { service: 'flow-scheduler' },
  format: format.combine(format.timestamp(), format.errors({ stack: true }), format.json()),
  level: env.LOG_LEVEL,
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.printf(({ timestamp, level, message, service, ...meta }) => {
          const metaString =
            Object.keys(meta).length > 0 ? `\n${JSON.stringify(meta, null, 2)}` : '';

          return `${String(timestamp)} [${String(service)}] ${String(level)}: ${String(message)}${metaString}`;
        }),
      ),
    }),
  ],
});

export default logger;
