import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

export const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  if (err.name === 'CastError') {
    message = `Resource not found. Invalid: ${err.path}`;
    statusCode = 400;
  }

  if (env.NODE_ENV === 'development') {
    logger.error(
      `[${req.method}] ${req.url} >> StatusCode:: ${statusCode}, Message:: ${message}`,
    );
  } else {
    logger.error(
      `[${req.method}] ${req.url} >> StatusCode:: ${statusCode}, Message:: ${message}`,
    );
  }

  res.status(statusCode).json({
    success: false,
    message,
    errors: err.errors || [],
    stack: env.NODE_ENV === 'development' ? err.stack : undefined,
  });
};
