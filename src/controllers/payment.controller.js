import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import * as paymentService from '../services/payment.service.js';

// @desc    Create Razorpay order
// @route   POST /api/v1/payments/create-order
// @access  Private/Student
export const createOrder = asyncHandler(async (req, res) => {
  const { item_id, item_type } = req.body;

  if (!item_id || !item_type) {
    throw new ApiError(400, 'item_id and item_type are required');
  }

  if (!['Course', 'MockTest', 'Hack', 'Resource'].includes(item_type)) {
    throw new ApiError(
      400,
      'item_type must be Course, MockTest, Hack or Resource',
    );
  }

  if (!/^[0-9a-fA-F]{24}$/.test(String(item_id))) {
    throw new ApiError(400, 'item_id is not a valid id');
  }

  // Normalize: frontend sends "MockTest" but backend models use "Hack"
  const normalizedItemType = item_type === 'MockTest' ? 'Hack' : item_type;

  const orderData = await paymentService.createOrder(
    req.user._id,
    item_id,
    normalizedItemType,
  );

  return res.json(new ApiResponse(200, orderData, 'Order created'));
});

// @desc    Get payment status
// @route   GET /api/v1/payments/status/:orderId
// @access  Private/Student
export const getPaymentStatus = asyncHandler(async (req, res) => {
  const { orderId } = req.params;

  if (!orderId) {
    throw new ApiError(400, 'orderId is required');
  }

  const statusData = await paymentService.getPaymentStatus(
    req.user._id,
    orderId,
  );

  return res.json(
    new ApiResponse(200, statusData, 'Payment status fetched successfully'),
  );
});

// @desc    Verify payment signature (Frontend Accelerator)
// @route   POST /api/v1/payments/verify
// @access  Private/Student
export const verifyPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
    req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw new ApiError(
      400,
      'razorpay_order_id, razorpay_payment_id, and razorpay_signature are required',
    );
  }

  const payment = await paymentService.verifyPayment(
    req.user._id,
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
  );

  return res.json(
    new ApiResponse(200, payment, 'Payment verified successfully'),
  );
});

// @desc    Razorpay webhook receiver
// @route   POST /api/v1/payments/webhook
// @access  Public (authenticated by HMAC signature, not by session)
//
// This is the only settlement path that survives the customer closing the tab
// the instant they pay. It must stay ahead of verifyJWT in the router.
export const razorpayWebhook = asyncHandler(async (req, res) => {
  const signature = req.header('x-razorpay-signature');

  // Signed over the exact bytes Razorpay sent — re-serialising req.body would
  // change key order and whitespace and never match.
  if (!req.rawBody) {
    throw new ApiError(
      400,
      'Webhook body could not be read. Expected a JSON payload.',
    );
  }

  const result = await paymentService.handleWebhookEvent(
    req.rawBody,
    signature,
  );

  // Always 200 once the signature is valid: Razorpay retries non-2xx for
  // hours, and an event we simply do not act on is not a failure.
  return res.status(200).json(new ApiResponse(200, result, 'Webhook received'));
});

// @desc    Refund a payment
// @route   POST /api/v1/payments/:paymentId/refund
// @access  Private/Admin
export const refundPayment = asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  const { amount, reason } = req.body || {};

  if (!/^[0-9a-fA-F]{24}$/.test(String(paymentId))) {
    throw new ApiError(400, 'paymentId is not a valid id');
  }

  const payment = await paymentService.refundPayment(paymentId, {
    amount,
    reason,
    actorId: req.user._id,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, payment, 'Refund issued successfully'));
});

// @desc    Force reconciliation of stuck payments
// @route   POST /api/v1/payments/reconcile
// @access  Private/Admin
export const reconcilePayments = asyncHandler(async (req, res) => {
  const summary = await paymentService.reconcileStalePayments({
    pendingOlderThanMinutes: Number(req.body?.older_than_minutes) || 10,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, summary, 'Reconciliation complete'));
});

// @desc    Get my active purchases
// @route   GET /api/v1/payments/my-purchases
// @access  Private/Student
export const getMyPurchases = asyncHandler(async (req, res) => {
  const purchases = await paymentService.getMyPurchases(req.user._id);

  return res
    .status(200)
    .json(new ApiResponse(200, purchases, 'Purchases fetched successfully'));
});

// @desc    Get my payment history
// @route   GET /api/v1/payments/my-history
// @access  Private/Student
export const getMyHistory = asyncHandler(async (req, res) => {
  const payments = await paymentService.getMyHistory(req.user._id);

  return res
    .status(200)
    .json(
      new ApiResponse(200, payments, 'Payment history fetched successfully'),
    );
});

// @desc    Get all purchases (Admin only)
// @route   GET /api/v1/payments/purchases
// @access  Private/Admin
export const getAllPurchases = asyncHandler(async (req, res) => {
  const purchases = await paymentService.getAllPurchases({
    page: req.query.page,
    limit: req.query.limit,
  });

  return res
    .status(200)
    .json(
      new ApiResponse(200, purchases, 'All purchases fetched successfully'),
    );
});
