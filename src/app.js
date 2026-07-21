import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler } from './middlewares/error.middleware.js';
import { ApiError } from './utils/ApiError.js';
import { correlationIdMiddleware } from './middlewares/correlation.middleware.js';

const app = express();

// Trust exactly ONE proxy hop (Hostinger's reverse proxy) so req.ip is the
// real client IP. Using `true` trusts every hop and lets clients spoof
// X-Forwarded-For — and can collapse many users onto one IP bucket.
app.set('trust proxy', 1);

// 0. Correlation ID
app.use(correlationIdMiddleware);

// 1. Security Headers
app.use(helmet());

// 2. CORS Policy
// The cors package compares CORS_ORIGIN against the browser's Origin header
// with exact string equality, and Origin never has a trailing slash — so
// "https://mastermocks.in/" in .env silently fails every preflight. Strip
// trailing slashes and accept a comma-separated list so the env value can't
// break CORS.
const corsOrigin =
  env.CORS_ORIGIN === '*'
    ? '*'
    : env.CORS_ORIGIN.split(',')
        .map((origin) => origin.trim().replace(/\/+$/, ''))
        .filter(Boolean);

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  }),
);

// 3. Request Logger
app.use(morgan('dev'));

// 4. Body Parsers & Cookie Parser
// --- MIDDLEWARES ---
app.use(
  express.json({
    limit: '16kb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: '16kb' }));
app.use(express.static('public'));
app.use(cookieParser());
app.use(auditLogger);

// --- SWAGGER DOCS ---
setupSwagger(app);

// 6. Data Sanitization against NoSQL query injection
app.use(mongoSanitize());

// --- ROUTES IMPORTS ---
import healthcheckRouter from './routes/healthcheck.routes.js';
import authRouter from './routes/auth.routes.js';
import userRouter from './routes/user.routes.js';
import categoryRouter from './routes/category.routes.js';
import courseRouter from './routes/course.routes.js';
import resourceRouter from './routes/resource.routes.js';
import hackRouter from './routes/hack.routes.js';
import testAttemptRouter from './routes/testAttempt.routes.js';
import paymentRouter from './routes/payment.routes.js';
import notificationRouter from './routes/notification.routes.js';
import dashboardRouter from './routes/dashboard.routes.js';
import leaderboardRouter from './routes/leaderboard.routes.js';
import inquiryRouter from './routes/inquiry.routes.js';
import { setupSwagger } from './swagger.js';
import { auditLogger } from './middlewares/audit.middleware.js';
import { setupExamWorker } from './jobs/examWorker.js';

// --- INITIALIZE BACKGROUND JOBS ---
setupExamWorker();

// --- ROUTES DECLARATION ---
app.use('/api/v1/healthcheck', healthcheckRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/users', userRouter);
app.use('/api/v1/categories', categoryRouter);
app.use('/api/v1/courses', courseRouter);
app.use('/api/v1/resources', resourceRouter);
app.use('/api/v1/hacks', hackRouter);
app.use('/api/v1/attempts', testAttemptRouter);
app.use('/api/v1/payments', paymentRouter);
app.use('/api/v1/notifications', notificationRouter);
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1/leaderboard', leaderboardRouter);
app.use('/api/v1/inquiries', inquiryRouter);

// --- 404 HANDLER FOR API ROUTES ---
app.all('/api/v1/*', (req, res, next) => {
  next(new ApiError(404, `Can't find ${req.originalUrl} on this server!`));
});

// --- GLOBAL ERROR HANDLER ---
app.use(errorHandler);

export default app;
