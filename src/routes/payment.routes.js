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
} from '../controllers/payment.controller.js';

const router = Router();

// ─── Protected routes ───────────────────────────────────────────────
router.use(verifyJWT);

router.post('/create-order', createOrder);
router.post('/verify', verifyPayment);
router.get('/status/:orderId', getPaymentStatus);
router.get('/my-purchases', getMyPurchases);
router.get('/my-history', getMyHistory);

// ─── Admin routes ───────────────────────────────────────────────────
router.get('/purchases', authorizeRoles('ADMIN'), getAllPurchases);

export default router;
