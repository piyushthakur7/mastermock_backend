import Redis from 'ioredis';
import { env } from '../config/env.js';

let redisClient;
try {
  redisClient = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
  redisClient.on('error', (err) =>
    console.warn('Redis connection error:', err.message),
  );
} catch (e) {
  console.warn('Could not connect to Redis');
}

export const redis = redisClient;
