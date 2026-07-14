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
  registerSchema,
  loginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../validators/auth.validator.js';
import {
  authLimiter,
  adminAuthLimiter,
  forgotPasswordLimiter,
} from '../middlewares/rateLimiter.middleware.js';

const router = Router();

// Public Routes
router.post('/register', validate(registerSchema), registerUser);
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
