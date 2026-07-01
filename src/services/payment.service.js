import Razorpay from 'razorpay';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Payment } from '../models/payment.model.js';
import { Purchase } from '../models/purchase.model.js';
import { Course } from '../models/course.model.js';
import { MockTest } from '../models/mockTest.model.js';
import { Enrollment } from '../models/enrollment.model.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

// ─── Razorpay Instance ─────────────────────────────────────────────
let razorpayInstance = null;

const getRazorpay = () => {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new ApiError(500, 'Razorpay API keys are not configured');
  }
  if (!razorpayInstance) {
    razorpayInstance = new Razorpay({
      key_id: env.RAZORPAY_KEY_ID,
      key_secret: env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpayInstance;
};

// ─── Helper: Look up item and validate price ────────────────────────
const lookupItem = async (itemId, itemType) => {
  let item = null;

  if (itemType === 'Course') {
    item = await Course.findOne({
      _id: itemId,
      isDeleted: false,
      is_active: true,
    });
  } else if (itemType === 'MockTest') {
    item = await MockTest.findOne({
      _id: itemId,
      isDeleted: false,
      is_active: true,
    });
  }

  if (!item) {
    throw new ApiError(404, `${itemType} not found`);
  }

  if (item.access_type !== 'paid') {
    throw new ApiError(
      400,
      `This ${itemType.toLowerCase()} is free, no payment required`,
    );
  }

  if (!item.price || item.price <= 0) {
    throw new ApiError(400, `Invalid price for ${itemType.toLowerCase()}`);
  }

  return item;
};

// ─── Helper: Grant access (Purchase + Enrollment) ───────────────────
const grantAccess = async (payment, userId) => {
  // Create Purchase if not already exists
  const existingPurchase = await Purchase.findOne({
    user: userId,
    item_id: payment.item_id,
    item_type: payment.item_type,
    status: 'ACTIVE',
  });

  if (!existingPurchase) {
    try {
      await Purchase.create({
        user: userId,
        item_id: payment.item_id,
        item_type: payment.item_type,
        payment: payment._id,
        amount: payment.amount,
        status: 'ACTIVE',
      });
      logger.info(
        `Purchase created for user=${userId}, item=${payment.item_id}`,
      );
    } catch (error) {
      // Ignore duplicate key error if another process created it concurrently
      if (error.code !== 11000) throw error;
    }
  }

  // Auto-enroll if Course
  if (payment.item_type === 'Course') {
    const existingEnrollment = await Enrollment.findOne({
      user: userId,
      course: payment.item_id,
    });

    if (!existingEnrollment) {
      try {
        await Enrollment.create({
          user: userId,
          course: payment.item_id,
        });
        logger.info(
          `Enrollment created for user=${userId}, course=${payment.item_id}`,
        );
      } catch (error) {
        if (error.code !== 11000) throw error;
      }
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════
// 1. CREATE ORDER
// ═══════════════════════════════════════════════════════════════════════
export const createOrder = async (userId, itemId, itemType) => {
  // Validate the item and get server-side price
  const item = await lookupItem(itemId, itemType);
  const amount = item.price;

  // Check if already purchased
  const existingPurchase = await Purchase.findOne({
    user: userId,
    item_id: itemId,
    item_type: itemType,
    status: 'ACTIVE',
  });

  if (existingPurchase) {
    throw new ApiError(400, 'You have already purchased this item');
  }

  // Idempotency: check for a recent PENDING payment for the same user+item
  // This prevents duplicate orders from rapid double-clicks
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const existingPending = await Payment.findOne({
    user: userId,
    item_id: itemId,
    item_type: itemType,
    status: 'PENDING',
    createdAt: { $gte: fiveMinutesAgo },
  });

  if (existingPending) {
    logger.info(
      `Returning existing pending order=${existingPending.razorpay_order_id} for user=${userId}`,
    );
    return {
      order_id: existingPending.razorpay_order_id,
      amount: existingPending.amount,
      currency: existingPending.currency,
      key_id: env.RAZORPAY_KEY_ID,
    };
  }

  // Create Razorpay order
  const razorpay = getRazorpay();
  const amountInPaise = Math.round(amount * 100);

  let order;
  try {
    order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `receipt_${Date.now()}_${userId.toString().slice(-6)}`,
    });
  } catch (error) {
    logger.error(`Razorpay order creation failed: ${error.message}`);
    throw new ApiError(
      500,
      'Failed to create payment order. Please try again.',
    );
  }

  if (!order || !order.id) {
    throw new ApiError(500, 'Failed to create payment order');
  }

  // Save pending payment record
  await Payment.create({
    user: userId,
    razorpay_order_id: order.id,
    amount,
    currency: 'INR',
    item_id: itemId,
    item_type: itemType,
    status: 'PENDING',
  });

  logger.info(
    `Order created: ${order.id} for user=${userId}, item=${itemId}, amount=${amount}`,
  );

  return {
    order_id: order.id,
    amount,
    currency: 'INR',
    key_id: env.RAZORPAY_KEY_ID,
  };
};

// ═══════════════════════════════════════════════════════════════════════
// 2. GET PAYMENT STATUS (NEW FLOW)
// ═══════════════════════════════════════════════════════════════════════
export const getPaymentStatus = async (userId, razorpayOrderId) => {
  // Find the payment record
  const payment = await Payment.findOne({ razorpay_order_id: razorpayOrderId });

  if (!payment) {
    throw new ApiError(404, 'Payment order not found');
  }

  // Security: ensure the payment belongs to the requesting user
  if (payment.user.toString() !== userId.toString()) {
    throw new ApiError(
      403,
      'Unauthorized: payment does not belong to this user',
    );
  }

  // Return the current status from our DB
  return {
    status: payment.status,
    order_id: payment.razorpay_order_id,
    payment_id: payment.razorpay_payment_id,
  };
};

// ═══════════════════════════════════════════════════════════════════════
// 2b. VERIFY PAYMENT (FRONTEND ACCELERATOR)
// ═══════════════════════════════════════════════════════════════════════
export const verifyPayment = async (
  userId,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
) => {
  // Find the payment record
  const payment = await Payment.findOne({ razorpay_order_id: razorpayOrderId });

  if (!payment) {
    throw new ApiError(404, 'Payment order not found');
  }

  // If already verified (e.g. by webhook), return immediately
  if (payment.status === 'SUCCESS') {
    logger.info(`Payment already verified: order=${razorpayOrderId}`);
    return payment;
  }

  // Security: ensure the payment belongs to the requesting user
  if (payment.user.toString() !== userId.toString()) {
    throw new ApiError(
      403,
      'Unauthorized: payment does not belong to this user',
    );
  }

  // HMAC signature verification — no fallback
  if (!env.RAZORPAY_KEY_SECRET) {
    throw new ApiError(500, 'Razorpay key secret is not configured');
  }

  const expectedSignature = crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const signatureBuffer = Buffer.from(razorpaySignature || '', 'hex');

  let isValid = false;
  if (expectedBuffer.length === signatureBuffer.length) {
    isValid = crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  } else {
    logger.warn(
      `Signature length mismatch for order=${razorpayOrderId}. Expected ${expectedBuffer.length}, got ${signatureBuffer.length}`,
    );
  }

  if (!isValid) {
    throw new ApiError(400, 'Payment verification failed: invalid signature');
  }

  // Signature valid — proceed with atomic success update
  try {
    const updatedPayment = await Payment.findOneAndUpdate(
      { _id: payment._id, status: 'PENDING' },
      {
        $set: {
          status: 'SUCCESS',
          razorpay_payment_id: razorpayPaymentId,
          razorpay_signature: razorpaySignature,
        },
      },
      { new: true },
    );

    if (!updatedPayment) {
      const currentPayment = await Payment.findById(payment._id);
      if (currentPayment && currentPayment.status === 'SUCCESS') {
        return currentPayment;
      }
      throw new ApiError(400, 'Payment could not be verified (invalid status)');
    }

    // Grant access (Purchase + Enrollment)
    await grantAccess(updatedPayment, userId);

    logger.info(
      `Payment verified successfully via accelerator: order=${razorpayOrderId}`,
    );
    return updatedPayment;
  } catch (error) {
    if (error.code === 11000) {
      const currentPayment = await Payment.findById(payment._id);
      if (currentPayment && currentPayment.status === 'SUCCESS') {
        return currentPayment;
      }
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, 'Payment was verified but processing failed.');
  }
};

// ═══════════════════════════════════════════════════════════════════════
// 3. WEBHOOK HANDLER
// ═══════════════════════════════════════════════════════════════════════
export const handleWebhook = async (rawBody, signature) => {
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    logger.error('Webhook: missing signature or secret');
    throw new ApiError(400, 'Webhook Error: Missing signature or secret');
  }

  // Verify webhook HMAC signature
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const signatureBuffer = Buffer.from(signature || '', 'hex');

  let isValid = false;
  if (expectedBuffer.length === signatureBuffer.length) {
    isValid = crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  }

  if (!isValid) {
    logger.error('Webhook: signature verification failed');
    throw new ApiError(400, 'Webhook Error: Invalid signature');
  }

  const body = JSON.parse(rawBody.toString('utf8'));
  const event = body.event;

  logger.info(`Webhook received: event=${event}`);

  // Handle payment success events
  if (['payment.captured', 'order.paid'].includes(event)) {
    const paymentEntity = body.payload.payment.entity;
    const { id: razorpayPaymentId, order_id: razorpayOrderId } = paymentEntity;

    try {
      const payment = await Payment.findOne({
        razorpay_order_id: razorpayOrderId,
      });

      if (!payment) {
        logger.warn(`Webhook: no payment found for order=${razorpayOrderId}`);
        return; // Return OK to acknowledge receipt
      }

      // Skip if already processed
      if (payment.status === 'SUCCESS') {
        logger.info(
          `Webhook: payment already processed for order=${razorpayOrderId}`,
        );
        return;
      }

      // Atomic Update payment to SUCCESS
      const updatedPayment = await Payment.findOneAndUpdate(
        { _id: payment._id, status: 'PENDING' },
        {
          $set: {
            status: 'SUCCESS',
            razorpay_payment_id: razorpayPaymentId,
            razorpay_signature: signature,
          },
        },
        { new: true },
      );

      // If updatedPayment is null, it was updated by another request
      if (updatedPayment) {
        // Grant access
        await grantAccess(updatedPayment, updatedPayment.user);
        logger.info(`Webhook: successfully processed order=${razorpayOrderId}`);
      } else {
        logger.info(
          `Webhook: payment processed concurrently for order=${razorpayOrderId}`,
        );
      }
    } catch (error) {
      logger.error(
        `Webhook: processing error for order=${razorpayOrderId}: ${error.message}`,
      );
      throw new ApiError(500, 'Webhook processing error');
    }
  }

  // Handle payment failure events
  if (event === 'payment.failed') {
    const paymentEntity = body.payload.payment.entity;
    const { order_id: razorpayOrderId } = paymentEntity;

    try {
      const payment = await Payment.findOne({
        razorpay_order_id: razorpayOrderId,
      });
      if (payment && payment.status !== 'SUCCESS') {
        payment.status = 'FAILED';
        await payment.save();
        logger.info(
          `Webhook: marked payment as FAILED for order=${razorpayOrderId}`,
        );
      }
    } catch (error) {
      logger.error(
        `Webhook: failed to update failed payment for order=${razorpayOrderId}: ${error.message}`,
      );
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════
// 4. GET MY PURCHASES
// ═══════════════════════════════════════════════════════════════════════
export const getMyPurchases = async (userId) => {
  return Purchase.find({ user: userId, status: 'ACTIVE' })
    .populate('item_id')
    .sort({ createdAt: -1 });
};

// ═══════════════════════════════════════════════════════════════════════
// 5. GET MY PAYMENT HISTORY
// ═══════════════════════════════════════════════════════════════════════
export const getMyHistory = async (userId) => {
  return Payment.find({ user: userId }).sort({ createdAt: -1 });
};
