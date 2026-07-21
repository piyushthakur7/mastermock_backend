import { Router } from 'express';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import { authorizeRoles } from '../middlewares/role.middleware.js';

import {
  createOrder,
  verifyPayment,
  getPaymentStatus,
  getMyPurchases,
  getMyHistory,
  getAllPurchases,
  razorpayWebhook,
  refundPayment,
  reconcilePayments,
} from '../controllers/payment.controller.js';

const router = Router();

// ─── Webhook (no session auth) ──────────────────────────────────────
// Razorpay calls this server-to-server, so it must sit ABOVE the verifyJWT
// mount below. It authenticates via its HMAC signature instead.
router.post('/webhook', razorpayWebhook);

// ─── Protected routes ───────────────────────────────────────────────
router.use(verifyJWT);

router.post('/create-order', createOrder);
router.post('/verify', verifyPayment);
router.get('/status/:orderId', getPaymentStatus);
router.get('/my-purchases', getMyPurchases);
router.get('/my-history', getMyHistory);

// ─── Admin routes ───────────────────────────────────────────────────
router.get('/purchases', authorizeRoles('ADMIN'), getAllPurchases);
router.post('/reconcile', authorizeRoles('ADMIN'), reconcilePayments);
router.post('/:paymentId/refund', authorizeRoles('ADMIN'), refundPayment);

export default router;
