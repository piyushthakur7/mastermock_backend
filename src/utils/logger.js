import winston from 'winston';

const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(
    (info) =>
      `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`,
  ),
);

import fs from 'fs';
import path from 'path';

// Ensure the logs directory exists to prevent ENOENT crash on Hostinger
const logDir = 'logs';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

const transports = [
  new winston.transports.Console(),
  new winston.transports.File({
    filename: path.join(logDir, 'error.log'),
    level: 'error',
  }),
  new winston.transports.File({ filename: path.join(logDir, 'all.log') }),
];

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
  levels: winston.config.npm.levels,
  format,
  transports,
});
