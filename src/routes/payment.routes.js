import { Router } from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { Payment } from '../models/payment.model.js';
import { Purchase } from '../models/purchase.model.js';
import { Course } from '../models/course.model.js';
import { MockTest } from '../models/mockTest.model.js';
import { Enrollment } from '../models/enrollment.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import mongoose from 'mongoose';

const router = Router();

// @desc    Razorpay Webhook for payment events
// @route   POST /api/v1/payments/webhook
// @access  Public
router.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;

    if (!signature || !webhookSecret) {
      console.error('Webhook missing signature or secret not configured');
      return res.status(400).send('Webhook Error: Missing signature or secret');
    }

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(req.rawBody)
      .digest('hex');

    if (signature !== expectedSignature) {
      console.error('Webhook signature verification failed');
      return res.status(400).send('Webhook Error: Invalid signature');
    }

    const event = req.body.event;
    console.log(`Received Razorpay webhook event: ${event}`);

    // We only process specific events
    if (['payment.captured', 'order.paid'].includes(event)) {
      const paymentEntity = req.body.payload.payment.entity;
      const { id: razorpay_payment_id, order_id: razorpay_order_id } =
        paymentEntity;

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const payment = await Payment.findOne({ razorpay_order_id }).session(
          session,
        );

        if (!payment) {
          console.log(`Payment not found for order_id: ${razorpay_order_id}`);
          await session.abortTransaction();
          session.endSession();
          return res.status(200).send('OK'); // Return 200 to acknowledge receipt
        }

        if (payment.status === 'SUCCESS') {
          console.log(
            `Payment already processed for order_id: ${razorpay_order_id}`,
          );
          await session.abortTransaction();
          session.endSession();
          return res.status(200).send('OK');
        }

        // Update payment
        payment.status = 'SUCCESS';
        payment.razorpay_payment_id = razorpay_payment_id;
        payment.razorpay_signature = signature; // Store webhook signature
        await payment.save({ session });

        // Create Purchase if not exists
        let purchase = await Purchase.findOne({
          user: payment.user,
          item_id: payment.item_id,
          item_type: payment.item_type,
          status: 'ACTIVE',
        }).session(session);

        if (!purchase) {
          await Purchase.create(
            [
              {
                user: payment.user,
                item_id: payment.item_id,
                item_type: payment.item_type,
                payment: payment._id,
                amount: payment.amount,
                status: 'ACTIVE',
              },
            ],
            { session },
          );
        }

        // Auto-enroll if Course
        if (payment.item_type === 'Course') {
          const existingEnrollment = await Enrollment.findOne({
            user: payment.user,
            course: payment.item_id,
          }).session(session);

          if (!existingEnrollment) {
            await Enrollment.create(
              [
                {
                  user: payment.user,
                  course: payment.item_id,
                },
              ],
              { session },
            );
          }
        }

        await session.commitTransaction();
        session.endSession();
        console.log(
          `Successfully processed webhook for order_id: ${razorpay_order_id}`,
        );
      } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error(
          `Error processing webhook for order_id: ${razorpay_order_id}`,
          error,
        );
        return res.status(500).send('Webhook processing error');
      }
    } else if (event === 'payment.failed') {
      const paymentEntity = req.body.payload.payment.entity;
      const { order_id: razorpay_order_id } = paymentEntity;

      try {
        const payment = await Payment.findOne({ razorpay_order_id });
        if (payment && payment.status !== 'SUCCESS') {
          payment.status = 'FAILED';
          await payment.save();
        }
      } catch (error) {
        console.error(
          `Error updating failed payment for order_id: ${razorpay_order_id}`,
          error,
        );
      }
    }

    res.status(200).send('OK');
  }),
);

router.use(verifyJWT);

const getRazorpayInstance = () => {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new ApiError(
      500,
      'Razorpay API keys are not configured in the backend',
    );
  }
  return new Razorpay({
    key_id: env.RAZORPAY_KEY_ID,
    key_secret: env.RAZORPAY_KEY_SECRET,
  });
};

// @desc    Create Razorpay order
// @route   POST /api/v1/payments/create-order
// @access  Private/Student
router.post(
  '/create-order',
  asyncHandler(async (req, res) => {
    const { item_id, item_type } = req.body;

    if (!item_id || !item_type) {
      throw new ApiError(400, 'item_id and item_type are required');
    }

    if (!['Course', 'MockTest'].includes(item_type)) {
      throw new ApiError(400, 'item_type must be Course or MockTest');
    }

    // Determine the price from the item
    let amount = 0;
    if (item_type === 'Course') {
      const course = await Course.findOne({
        _id: item_id,
        isDeleted: false,
        is_active: true,
      });
      if (!course) throw new ApiError(404, 'Course not found');
      if (course.access_type !== 'paid')
        throw new ApiError(400, 'This course is free, no payment required');
      amount = course.price;
    } else if (item_type === 'MockTest') {
      const mockTest = await MockTest.findOne({
        _id: item_id,
        isDeleted: false,
        is_active: true,
      });
      if (!mockTest) throw new ApiError(404, 'Mock Test not found');
      if (mockTest.access_type !== 'paid')
        throw new ApiError(400, 'This test is free, no payment required');
      amount = mockTest.price;
    }

    if (amount <= 0) {
      throw new ApiError(400, 'Invalid item price');
    }

    // Check if already purchased
    const existingPurchase = await Purchase.findOne({
      user: req.user._id,
      item_id,
      item_type,
      status: 'ACTIVE',
    });
    if (existingPurchase) {
      throw new ApiError(400, 'You have already purchased this item');
    }

    const razorpay = getRazorpayInstance();

    const options = {
      amount: Math.round(amount * 100), // amount in smallest currency unit (paise), rounded to avoid precision issues
      currency: 'INR',
      receipt: `receipt_order_${Date.now()}`,
    };

    let order;
    try {
      order = await razorpay.orders.create(options);
    } catch (error) {
      throw new ApiError(
        500,
        'Razorpay error: ' + (error.message || 'Failed to create order'),
      );
    }

    if (!order)
      throw new ApiError(500, 'Some error occurred while creating order');

    // Save pending payment record
    await Payment.create({
      user: req.user._id,
      razorpay_order_id: order.id,
      amount: amount,
      currency: 'INR',
      item_id,
      item_type,
      status: 'PENDING',
    });

    res.json(
      new ApiResponse(
        200,
        {
          order_id: order.id,
          amount: amount,
          currency: 'INR',
          key_id: env.RAZORPAY_KEY_ID,
        },
        'Order created',
      ),
    );
  }),
);

// @desc    Verify payment
// @route   POST /api/v1/payments/verify
// @access  Private/Student
router.post(
  '/verify',
  asyncHandler(async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new ApiError(
        400,
        'razorpay_order_id, razorpay_payment_id, and razorpay_signature are required',
      );
    }

    const payment = await Payment.findOne({ razorpay_order_id });
    if (!payment) throw new ApiError(404, 'Order not found');

    if (!env.RAZORPAY_KEY_SECRET) {
      throw new ApiError(
        500,
        'Razorpay API keys are not configured in the backend',
      );
    }

    const hmac = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET);
    hmac.update(razorpay_order_id + '|' + razorpay_payment_id);
    const generated_signature = hmac.digest('hex');

    if (generated_signature !== razorpay_signature) {
      payment.status = 'FAILED';
      await payment.save();
      throw new ApiError(400, 'Payment verification failed');
    }

    if (payment.status === 'SUCCESS') {
      return res.json(
        new ApiResponse(200, payment, 'Payment already verified successfully'),
      );
    }

    if (generated_signature === razorpay_signature) {
      // Use findOneAndUpdate to prevent VersionError race condition with webhook
      const updatedPayment = await Payment.findOneAndUpdate(
        { _id: payment._id, status: 'PENDING' },
        {
          $set: {
            status: 'SUCCESS',
            razorpay_payment_id: razorpay_payment_id,
            razorpay_signature: razorpay_signature,
          },
        },
        { new: true },
      );

      // If updatedPayment is null, it means it was already processed (e.g. by webhook)
      if (!updatedPayment) {
        const currentPayment = await Payment.findById(payment._id);
        if (currentPayment && currentPayment.status === 'SUCCESS') {
          return res.json(
            new ApiResponse(
              200,
              currentPayment,
              'Payment already verified successfully',
            ),
          );
        }
        throw new ApiError(
          400,
          'Payment could not be verified (invalid status)',
        );
      }

      // Create Purchase Record if not exists
      const existingPurchase = await Purchase.findOne({
        user: req.user._id,
        item_id: updatedPayment.item_id,
        item_type: updatedPayment.item_type,
        status: 'ACTIVE',
      });

      if (!existingPurchase) {
        await Purchase.create({
          user: req.user._id,
          item_id: updatedPayment.item_id,
          item_type: updatedPayment.item_type,
          payment: updatedPayment._id,
          amount: updatedPayment.amount,
          status: 'ACTIVE',
        });
      }

      // If it's a course, auto-enroll
      if (updatedPayment.item_type === 'Course') {
        const existingEnrollment = await Enrollment.findOne({
          user: req.user._id,
          course: updatedPayment.item_id,
        });
        if (!existingEnrollment) {
          try {
            await Enrollment.create({
              user: req.user._id,
              course: updatedPayment.item_id,
            });
          } catch (error) {
            // Ignore duplicate key error (11000) which can happen if webhook auto-enrolled concurrently
            if (error.code !== 11000) {
              console.error('Error creating enrollment:', error);
            }
          }
        }
      }

      return res.json(
        new ApiResponse(200, updatedPayment, 'Payment verified successfully'),
      );
    } else {
      await Payment.findOneAndUpdate(
        { _id: payment._id, status: 'PENDING' },
        { $set: { status: 'FAILED' } },
      );
      throw new ApiError(400, 'Payment verification failed');
    }
  }),
);

// @desc    Get my purchases
// @route   GET /api/v1/payments/my-purchases
// @access  Private/Student
router.get(
  '/my-purchases',
  asyncHandler(async (req, res) => {
    const purchases = await Purchase.find({
      user: req.user._id,
      status: 'ACTIVE',
    })
      .populate('item_id')
      .sort({ createdAt: -1 });

    return res
      .status(200)
      .json(new ApiResponse(200, purchases, 'Purchases fetched successfully'));
  }),
);

// @desc    Get my payment history
// @route   GET /api/v1/payments/my-history
// @access  Private/Student
router.get(
  '/my-history',
  asyncHandler(async (req, res) => {
    const payments = await Payment.find({
      user: req.user._id,
    }).sort({ createdAt: -1 });

    return res
      .status(200)
      .json(
        new ApiResponse(200, payments, 'Payment history fetched successfully'),
      );
  }),
);

export default router;
