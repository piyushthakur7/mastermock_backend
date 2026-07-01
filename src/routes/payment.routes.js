import { Router } from 'express';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import {
  paymentLimiter,
  verifyLimiter,
} from '../middlewares/rateLimiter.middleware.js';
import {
  createOrder,
  verifyPayment,
  getPaymentStatus,
  handleWebhook,
  getMyPurchases,
  getMyHistory,
} from '../controllers/payment.controller.js';

const router = Router();

// ─── Public route (HMAC-authenticated, no JWT) ──────────────────────
// Must be BEFORE verifyJWT middleware
router.post('/webhook', handleWebhook);

// ─── Protected routes ───────────────────────────────────────────────
router.use(verifyJWT);

router.post('/create-order', paymentLimiter, createOrder);
router.post('/verify', verifyLimiter, verifyPayment);
router.get('/status/:orderId', verifyLimiter, getPaymentStatus);
router.get('/my-purchases', getMyPurchases);
router.get('/my-history', getMyHistory);

export default router;
