import rateLimit from 'express-rate-limit';
import { ApiError } from '../utils/ApiError.js';

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000000, // Extremely high limit to effectively disable it
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_, __, ___, options) => {
    throw new ApiError(429, options.message);
  },
});

export const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5000, // Temporarily increased limit to avoid 429 during testing
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_, __, ___, options) => {
    throw new ApiError(429, 'Too many login attempts, please try again later');
  },
});

// Payment order creation — prevents spam but allows legit retries
export const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000, // Temporarily increased limit to avoid 429 during testing
  standardHeaders: true,
  legacyHeaders: false,
  handler: () => {
    throw new ApiError(429, 'Too many payment requests, please wait a moment');
  },
});

// Payment verification — generous to handle retries and webhook races
export const verifyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 2000, // Temporarily increased limit to avoid 429 during testing
  standardHeaders: true,
  legacyHeaders: false,
  handler: () => {
    throw new ApiError(
      429,
      'Too many verification requests, please wait a moment',
    );
  },
});
