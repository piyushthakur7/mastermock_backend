import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

export const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  if (err.name === 'CastError') {
    message = `Resource not found. Invalid: ${err.path}`;
    statusCode = 400;
  }

  const duration = req.startTime
    ? (() => {
        const diff = process.hrtime(req.startTime);
        return (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2) + 'ms';
      })()
    : 'unknown';

  const logPayload = {
    correlationId: req.correlationId || 'none',
    method: req.method,
    url: req.originalUrl,
    statusCode,
    message,
    duration,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    body: Object.keys(req.body || {}).length ? req.body : undefined,
    stack: err.stack,
  };

  if (env.NODE_ENV === 'development') {
    logger.error(JSON.stringify(logPayload, null, 2));
  } else {
    logger.error(JSON.stringify(logPayload));
  }

  res.status(statusCode).json({
    success: false,
    message,
    errors: err.errors || [],
    stack: env.NODE_ENV === 'development' ? err.stack : undefined,
  });
};
