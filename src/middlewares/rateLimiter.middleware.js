import rateLimit from "express-rate-limit";
import { ApiError } from "../utils/ApiError.js";

export const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_, __, ___, options) => {
        throw new ApiError(429, options.message);
    }
});

export const authLimiter = rateLimit({
    // windowMs: 60 * 60 * 1000,
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // limit each IP to 10 requests per windowMs for auth routes
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_, __, ___, options) => {
        throw new ApiError(429, "Too many login attempts, please try again later");
    }
});
