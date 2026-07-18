import crypto from 'crypto';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

/**
 * Rate limiting for authentication endpoints ONLY.
 *
 * IMPORTANT: There is deliberately NO global `/api` limiter. A global per-IP
 * limiter previously caused production 429 storms — rapid admin navigation
 * fires many concurrent GETs from one IP and tripped the shared bucket
 * (and, behind Hostinger's reverse proxy, multiple users could collapse into
 * a single bucket). These limiters guard brute-force on auth routes only and
 * are keyed by IP + email so normal traffic is never affected.
 *
 * Backing store: an in-process Map. Per-process and resets on restart —
 * acceptable for brute-force mitigation on a single instance.
 */

const memoryStore = new Map();

// Opportunistic cleanup so the in-memory Map can't grow unbounded.
const sweepMemoryStore = () => {
  const now = Date.now();
  for (const [key, record] of memoryStore) {
    if (now > record.expiresAt) memoryStore.delete(key);
  }
};

const getClientIp = (req) => req.ip || 'unknown';

const getNormalizedEmailHash = (email) => {
  if (!email) return 'no-email';
  const normalized = String(email).trim().toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex');
};

const buildKey = (prefix, req) =>
  `rate-limit:${prefix}:${getClientIp(req)}:${getNormalizedEmailHash(
    req.body?.email,
  )}`;

const handleMemoryLimit = (key, windowMs) => {
  const now = Date.now();
  let record = memoryStore.get(key);

  if (!record || now > record.expiresAt) {
    record = { attempts: 1, expiresAt: now + windowMs };
  } else {
    record.attempts += 1;
  }

  memoryStore.set(key, record);
  return {
    attempts: record.attempts,
    ttlSeconds: Math.max(1, Math.ceil((record.expiresAt - now) / 1000)),
  };
};

/**
 * Clear a rate-limit counter. Called after a successful login so a user who
 * mistyped their password a few times is not penalised once they get in.
 */
export const clearRateLimitKey = (req, prefix = 'login') => {
  memoryStore.delete(buildKey(prefix, req));
};

export const createRateLimiter = ({
  prefix = 'auth',
  maxAttempts = 10,
  windowMs = 15 * 60 * 1000,
  message = 'Too many requests. Please wait a while before trying again.',
}) => {
  return (req, res, next) => {
    try {
      const key = buildKey(prefix, req);

      if (memoryStore.size > 5000) sweepMemoryStore();
      const { attempts, ttlSeconds } = handleMemoryLimit(key, windowMs);

      res.setHeader('RateLimit-Limit', maxAttempts);
      res.setHeader('RateLimit-Remaining', Math.max(0, maxAttempts - attempts));
      res.setHeader(
        'RateLimit-Reset',
        Math.floor(Date.now() / 1000) + ttlSeconds,
      );

      if (attempts > maxAttempts) {
        res.setHeader('Retry-After', ttlSeconds);
        logger.warn({
          reason: 'rate_limit',
          route: req.originalUrl,
          ip: getClientIp(req),
          attempts,
          userAgent: req.headers['user-agent'],
        });
        // Goes through the global errorHandler => proper JSON body
        // { success:false, message } instead of an empty 429.
        return next(new ApiError(429, message));
      }

      next();
    } catch (error) {
      // Never let the limiter take down a request path.
      logger.error('Rate limiter critical error:', error);
      next();
    }
  };
};

export const authLimiter = createRateLimiter({
  prefix: 'login',
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000,
  message: 'Too many login attempts. Please wait a while before trying again.',
});

export const adminAuthLimiter = createRateLimiter({
  prefix: 'admin-login',
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000,
  message:
    'Too many admin login attempts. Please wait a while before trying again.',
});

export const registerLimiter = createRateLimiter({
  prefix: 'register',
  maxAttempts: 15,
  windowMs: 60 * 60 * 1000,
  message: 'Too many sign-up attempts. Please try again later.',
});

export const forgotPasswordLimiter = createRateLimiter({
  prefix: 'forgot-pwd',
  maxAttempts: 5,
  windowMs: 60 * 60 * 1000,
  message:
    'Too many password reset requests. Please wait an hour before trying again.',
});
