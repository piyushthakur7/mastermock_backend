import { Router } from 'express';
import { verifyJWT } from '../middlewares/auth.middleware.js';

import {
  createOrder,
  verifyPayment,
  getPaymentStatus,
  getMyPurchases,
  getMyHistory,
} from '../controllers/payment.controller.js';

const router = Router();

// ─── Protected routes ───────────────────────────────────────────────
router.use(verifyJWT);

router.post('/create-order', createOrder);
router.post('/verify', verifyPayment);
router.get('/status/:orderId', getPaymentStatus);
router.get('/my-purchases', getMyPurchases);
router.get('/my-history', getMyHistory);

export default router;
