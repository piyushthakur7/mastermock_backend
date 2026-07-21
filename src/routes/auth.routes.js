import { Router } from 'express';
import {
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  changeCurrentPassword,
  forgotPassword,
  resetPassword,
  adminLogin,
} from '../controllers/auth.controller.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  authLimiter,
  adminAuthLimiter,
  registerLimiter,
  forgotPasswordLimiter,
} from '../middlewares/rateLimiter.middleware.js';
import {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../validators/auth.validator.js';

const router = Router();

// Public Routes
//
// These limiters are keyed by IP + email hash, so ordinary traffic is never
// affected — they exist purely to stop credential stuffing. There is
// deliberately NO global /api limiter: a shared per-IP bucket previously
// caused 429 storms when admin navigation fired many concurrent GETs, and
// behind a reverse proxy several users can collapse into one bucket.
router.post(
  '/register',
  registerLimiter,
  validate(registerSchema),
  registerUser,
);
router.post('/login', authLimiter, validate(loginSchema), loginUser);
router.post(
  '/admin-login',
  adminAuthLimiter,
  validate(loginSchema),
  adminLogin,
);
router.post('/refresh-token', refreshAccessToken);
router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  validate(forgotPasswordSchema),
  forgotPassword,
);
router.post(
  '/reset-password/:token',
  authLimiter,
  validate(resetPasswordSchema),
  resetPassword,
);

// Secured Routes
router.post('/logout', verifyJWT, logoutUser);
router.post(
  '/change-password',
  verifyJWT,
  validate(changePasswordSchema),
  changeCurrentPassword,
);

export default router;
