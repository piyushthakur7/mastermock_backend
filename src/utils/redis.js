import Redis from 'ioredis';
import { env } from '../config/env.js';

let redisClient;
try {
  if (env.REDIS_URL && env.REDIS_URL !== 'redis://localhost:6379') {
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      retryStrategy(times) {
        if (times > 3) {
          return null; // Stop retrying after 3 attempts
        }
        return Math.min(times * 50, 2000);
      },
    });
    redisClient.on('error', (err) =>
      console.warn('Redis connection error:', err.message),
    );
  } else {
    console.warn(
      'Redis URL not provided or is localhost. Skipping Redis in production/serverless.',
    );
  }
} catch (e) {
  console.warn('Could not connect to Redis');
}

export const redis = redisClient;
