import rateLimit from 'express-rate-limit';
import { ApiError } from '../utils/ApiError.js';

// Helper to extract real client IP behind Hostinger's reverse proxy (LiteSpeed/nginx)
const getClientIp = (req) => {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.ip ||
    req.connection?.remoteAddress ||
    'unknown'
  );
};

// Auth rate limiter — prevents brute-force login attacks
// Only applied on login/register routes
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 login attempts per 15 min per IP — generous for real users
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  handler: (_, __, ___, options) => {
    throw new ApiError(429, 'Too many login attempts, please try again later');
  },
});

// Payment order creation — prevents spam but allows legit retries
export const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 order creations per minute per IP — very generous
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  handler: () => {
    throw new ApiError(429, 'Too many payment requests, please wait a moment');
  },
});

// Payment verification — generous to handle retries and webhook races
export const verifyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 verify requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  handler: () => {
    throw new ApiError(
      429,
      'Too many verification requests, please wait a moment',
    );
  },
});
