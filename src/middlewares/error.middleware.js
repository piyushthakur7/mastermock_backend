import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

// Error logs capture the request body, which on the auth routes means
// plaintext passwords and reset tokens land in logs/. Mask them.
const SENSITIVE_FIELDS = new Set([
  'password',
  'newPassword',
  'oldPassword',
  'confirmPassword',
  'password_hash',
  'token',
  'accessToken',
  'refreshToken',
  'razorpay_signature',
]);

const redactBody = (body) => {
  if (!body || typeof body !== 'object') return undefined;
  const keys = Object.keys(body);
  if (!keys.length) return undefined;

  return keys.reduce((acc, key) => {
    acc[key] = SENSITIVE_FIELDS.has(key) ? '[REDACTED]' : body[key];
    return acc;
  }, {});
};

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
    body: redactBody(req.body),
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
