import crypto from 'crypto';

export const correlationIdMiddleware = (req, res, next) => {
  // Use provided correlation ID or generate a new one
  req.correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();

  // Track request start time for latency measurement
  req.startTime = process.hrtime();

  // Set in response headers so frontend can trace it
  res.setHeader('x-correlation-id', req.correlationId);

  next();
};
