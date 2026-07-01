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

  if (!['Course', 'MockTest'].includes(item_type)) {
    throw new ApiError(400, 'item_type must be Course or MockTest');
  }

  const orderData = await paymentService.createOrder(
    req.user._id,
    item_id,
    item_type,
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

// @desc    Razorpay webhook handler
// @route   POST /api/v1/payments/webhook
// @access  Public (HMAC-authenticated)
export const handleWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];

  await paymentService.handleWebhook(req.rawBody, signature);

  return res.status(200).send('OK');
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
