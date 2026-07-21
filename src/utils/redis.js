import { env } from '../config/env.js';

/**
 * Optional Redis connection for the rate limiter.
 *
 * `ioredis` is imported dynamically and failures degrade to null rather than
 * throwing: a missing package or an unreachable server must not stop the app
 * from booting, it just means rate limiting falls back to its in-process
 * store (per-instance, but still effective against brute force).
 */
let redisClient = null;

if (env.REDIS_URL) {
  try {
    const { default: Redis } = await import('ioredis');
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
      retryStrategy(times) {
        if (times > 3) return null; // stop retrying
        return Math.min(times * 50, 2000);
      },
    });
    redisClient.on('error', (err) =>
      console.warn('Redis connection error:', err.message),
    );
  } catch (error) {
    console.warn(
      `Redis unavailable (${error.message}). Rate limiting will use the in-process store.`,
    );
    redisClient = null;
  }
} else {
  console.warn(
    'REDIS_URL not set. Rate limiting will use the in-process store (per-instance).',
  );
}

export const redis = redisClient;
