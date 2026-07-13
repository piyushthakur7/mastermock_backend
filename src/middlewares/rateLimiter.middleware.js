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

// Auth rate limiter (Disabled)
export const authLimiter = (req, res, next) => next();

// Payment order creation (Disabled)
export const paymentLimiter = (req, res, next) => next();

// Payment verification (Disabled)
export const verifyLimiter = (req, res, next) => next();
