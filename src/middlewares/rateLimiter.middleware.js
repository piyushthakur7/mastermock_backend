import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';
import { redis } from '../utils/redis.js';

const memoryStore = new Map();

const getClientIp = (req) => {
  return req.ip || 'unknown';
};

const getNormalizedEmailHash = (email) => {
  if (!email) return 'no-email';
  const normalized = String(email).trim().toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex');
};

export const clearRateLimitKey = async (req, prefix = 'login') => {
  const ip = getClientIp(req);
  const emailHash = getNormalizedEmailHash(req.body?.email);
  const key = `rate-limit:${prefix}:${ip}:${emailHash}`;

  try {
    if (redis) {
      await redis.del(key);
    } else {
      memoryStore.delete(key);
    }
  } catch (error) {
    logger.error(`Error clearing rate limit key ${key}:`, error);
  }
};

const handleMemoryLimit = (key, windowMs) => {
  const now = Date.now();
  let record = memoryStore.get(key);

  if (!record || now > record.expiresAt) {
    record = { attempts: 1, expiresAt: now + windowMs };
  } else {
    record.attempts += 1;
  }

  memoryStore.set(key, record);
  return record.attempts;
};

export const createRateLimiter = ({
  prefix = 'auth',
  maxAttempts = 5,
  windowMs = 15 * 60 * 1000,
  message = 'Too many requests. Please wait a while before trying again.',
}) => {
  return async (req, res, next) => {
    try {
      const ip = getClientIp(req);
      const emailHash = getNormalizedEmailHash(req.body?.email);
      const key = `rate-limit:${prefix}:${ip}:${emailHash}`;
      const windowSeconds = Math.floor(windowMs / 1000);

      let attempts = 0;
      let ttlSeconds = windowSeconds;

      if (redis) {
        try {
          const multi = redis.multi();
          multi.incr(key);
          multi.expire(key, windowSeconds, 'NX');
          const results = await multi.exec();

          if (results && results[0] && results[0][1]) {
            attempts = results[0][1];
          } else {
            // Fallback if atomic operation result parsing fails
            attempts = await redis.get(key);
          }

          const ttl = await redis.ttl(key);
          if (ttl > 0) ttlSeconds = ttl;
        } catch (redisError) {
          logger.error(
            'Redis rate limiter error, falling back to memory:',
            redisError,
          );
          attempts = handleMemoryLimit(key, windowMs);
        }
      } else {
        attempts = handleMemoryLimit(key, windowMs);
      }

      res.setHeader('RateLimit-Limit', maxAttempts);
      res.setHeader('RateLimit-Remaining', Math.max(0, maxAttempts - attempts));
      res.setHeader(
        'RateLimit-Reset',
        Math.floor(Date.now() / 1000) + ttlSeconds,
      );

      if (attempts > maxAttempts) {
        res.setHeader('Retry-After', ttlSeconds);
        logger.warn({
          ip,
          emailHash,
          route: req.originalUrl,
          userAgent: req.headers['user-agent'],
          reason: 'rate_limit',
          attempts,
        });
        return next(new ApiError(429, message));
      }

      next();
    } catch (error) {
      logger.error('Rate Limiter Critical Error:', error);
      next();
    }
  };
};

export const authLimiter = createRateLimiter({
  prefix: 'login',
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  message: 'Too many login attempts. Please wait a while before trying again.',
});

export const adminAuthLimiter = createRateLimiter({
  prefix: 'admin-login',
  maxAttempts: 3,
  windowMs: 30 * 60 * 1000,
  message:
    'Too many admin login attempts. Please wait a while before trying again.',
});

export const forgotPasswordLimiter = createRateLimiter({
  prefix: 'forgot-pwd',
  maxAttempts: 3,
  windowMs: 60 * 60 * 1000,
  message:
    'Too many password reset requests. Please wait an hour before trying again.',
});

// Payment order creation (Disabled)
export const paymentLimiter = (req, res, next) => next();

// Payment verification (Disabled)
export const verifyLimiter = (req, res, next) => next();
