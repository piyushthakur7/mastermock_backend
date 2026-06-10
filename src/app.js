import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import morgan from 'morgan';
import { env } from './config/env.js';
import { globalLimiter } from './middlewares/rateLimiter.middleware.js';
import { errorHandler } from './middlewares/error.middleware.js';

const app = express();

// 1. Security Headers
app.use(helmet());

// 2. CORS Policy
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  }),
);

// 3. Request Logger
app.use(morgan('dev'));

// 4. Rate Limiting
app.use('/api', globalLimiter);

// 5. Body Parsers & Cookie Parser
// --- MIDDLEWARES ---
app.use(express.json({ limit: '16kb' }));
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
import mockTestRouter from './routes/mockTest.routes.js';
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
app.use('/api/v1/mock-tests', mockTestRouter);
app.use('/api/v1/attempts', testAttemptRouter);
app.use('/api/v1/payments', paymentRouter);
app.use('/api/v1/notifications', notificationRouter);
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1/leaderboard', leaderboardRouter);
app.use('/api/v1/inquiries', inquiryRouter);

// --- GLOBAL ERROR HANDLER ---
app.use(errorHandler);

export default app;
