import winston from 'winston';
import fs from 'fs';
import path from 'path';

const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(
    (info) =>
      `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`,
  ),
);

const transports = [new winston.transports.Console()];

// Serverless filesystems are read-only outside /tmp. Creating the log
// directory at import time threw EROFS before any handler was reachable, so
// the app could not boot on Vercel at all. File logging is best-effort.
const isServerless = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_VERSION,
);

if (!isServerless) {
  try {
    const logDir = path.join(process.cwd(), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    transports.push(
      new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
      }),
      new winston.transports.File({ filename: path.join(logDir, 'all.log') }),
    );
  } catch (error) {
    console.warn(`File logging disabled: ${error.message}`);
  }
}

// Production used to log at `warn`, which silently dropped every payment
// breadcrumb (order created, payment verified, access granted) — all of which
// are logger.info. Those are the only record of what happened to a customer's
// money, so they must survive in production.
const level =
  process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'error' : 'info');

export const logger = winston.createLogger({
  level,
  levels: winston.config.npm.levels,
  format,
  transports,
});
