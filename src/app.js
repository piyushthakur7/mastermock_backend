import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import mongoSanitize from "express-mongo-sanitize";
import morgan from "morgan";
import { env } from "./config/env.js";
import { globalLimiter } from "./middlewares/rateLimiter.middleware.js";
import { errorHandler } from "./middlewares/error.middleware.js";

const app = express();

// 1. Security Headers
app.use(helmet());

// 2. CORS Policy
app.use(cors({
    origin: env.CORS_ORIGIN,
    credentials: true
}));

// 3. Request Logger
app.use(morgan("dev"));

// 4. Rate Limiting
app.use("/api", globalLimiter);

// 5. Body Parsers & Cookie Parser
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.static("public"));
app.use(cookieParser());

// 6. Data Sanitization against NoSQL query injection
app.use(mongoSanitize());

// --- ROUTES IMPORTS ---
import healthcheckRouter from "./routes/healthcheck.routes.js";

// --- ROUTES DECLARATION ---
app.use("/api/v1/healthcheck", healthcheckRouter);

// --- GLOBAL ERROR HANDLER ---
app.use(errorHandler);

export default app;
