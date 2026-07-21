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

/**
 * Decide what the client is allowed to see.
 *
 * Anything not explicitly recognised is reported as a generic 500. Echoing
 * `err.message` for unknown errors leaked Mongo driver internals — a duplicate
 * key error, for example, returned the database name, the index definition and
 * the conflicting value, which also confirmed whether an account existed.
 */
const toClientError = (err) => {
  if (err?.isOperational) {
    return {
      statusCode: err.statusCode || 500,
      message: err.message,
      errors: err.errors || [],
      errorCode: err.errorCode,
    };
  }

  if (err?.name === 'CastError') {
    return {
      statusCode: 400,
      message: `Invalid value for ${err.path}`,
      errors: [],
    };
  }

  if (err?.name === 'ValidationError') {
    const errors = Object.values(err.errors || {}).map((e) => e.message);
    return {
      statusCode: 400,
      message: errors.join(', ') || 'Validation failed',
      errors,
    };
  }

  // Duplicate key. Name the field so the client can act on it, but never the
  // collection, index or conflicting value.
  if (err?.code === 11000) {
    const fields = Object.keys(err.keyPattern || err.keyValue || {});
    return {
      statusCode: 409,
      message: fields.length
        ? `A record with this ${fields.join(' + ')} already exists`
        : 'That value is already taken',
      errors: [],
    };
  }

  if (err?.name === 'JsonWebTokenError') {
    return { statusCode: 401, message: 'Invalid token', errors: [] };
  }

  if (err?.name === 'TokenExpiredError') {
    return { statusCode: 401, message: 'Token expired', errors: [] };
  }

  // Multer and body-parser surface these on oversized uploads/bodies.
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return { statusCode: 413, message: 'File is too large', errors: [] };
  }
  if (err?.type === 'entity.too.large') {
    return {
      statusCode: 413,
      message: 'Request body is too large',
      errors: [],
    };
  }

  return { statusCode: 500, message: 'Internal Server Error', errors: [] };
};

export const errorHandler = (err, req, res, next) => {
  const { statusCode, message, errors, errorCode } = toClientError(err);

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
    // Log the real error internally even when the client gets a generic one.
    message: err?.message || message,
    duration,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    body: redactBody(req.body),
    stack: err?.stack,
  };

  if (statusCode >= 500) {
    logger.error(
      JSON.stringify(
        logPayload,
        null,
        env.NODE_ENV === 'development' ? 2 : undefined,
      ),
    );
  } else {
    logger.warn(JSON.stringify(logPayload));
  }

  // Streaming responses (file downloads) can fail after headers are already
  // out; writing a second status throws and takes the process with it.
  if (res.headersSent) {
    return next(err);
  }

  res.status(statusCode).json({
    success: false,
    message,
    errors,
    ...(errorCode ? { errorCode } : {}),
    stack: env.NODE_ENV === 'development' ? err?.stack : undefined,
  });
};
