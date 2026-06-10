import { Router } from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { Payment } from '../models/payment.model.js';
import { Purchase } from '../models/purchase.model.js';
import { Course } from '../models/course.model.js';
import { Enrollment } from '../models/enrollment.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';

const router = Router();
router.use(verifyJWT);

const razorpay = new Razorpay({
  key_id: env.RAZORPAY_KEY_ID || 'dummy_key',
  key_secret: env.RAZORPAY_KEY_SECRET || 'dummy_secret',
});

// @desc    Create Razorpay order
router.post(
  '/create-order',
  asyncHandler(async (req, res) => {
    const { item_id, item_type, amount } = req.body;

    const options = {
      amount: amount * 100, // amount in smallest currency unit
      currency: 'INR',
      receipt: `receipt_order_${Date.now()}`,
    };

    const order = await razorpay.orders.create(options);
    if (!order)
      throw new ApiError(500, 'Some error occurred while creating order');

    // Save pending payment record
    await Payment.create({
      user: req.user._id,
      order_id: order.id,
      amount: amount,
      currency: 'INR',
      payment_status: 'PENDING',
      item_id,
      item_type,
    });

    res.json(new ApiResponse(200, order, 'Order created'));
  }),
);

// @desc    Verify payment
router.post(
  '/verify',
  asyncHandler(async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body;

    const payment = await Payment.findOne({ order_id: razorpay_order_id });
    if (!payment) throw new ApiError(404, 'Order not found');

    const hmac = crypto.createHmac(
      'sha256',
      env.RAZORPAY_KEY_SECRET || 'dummy_secret',
    );
    hmac.update(razorpay_order_id + '|' + razorpay_payment_id);
    const generated_signature = hmac.digest('hex');

    if (generated_signature === razorpay_signature) {
      payment.payment_status = 'SUCCESS';
      payment.payment_id = razorpay_payment_id;
      await payment.save();

      // Create Purchase Record
      await Purchase.create({
        user: req.user._id,
        item: payment.item_id,
        itemModel: payment.item_type,
        payment: payment._id,
        amount: payment.amount,
        status: 'ACTIVE',
      });

      // If it's a course, auto-enroll
      if (payment.item_type === 'Course') {
        await Enrollment.create({
          student: req.user._id,
          course: payment.item_id,
        });
      }

      res.json(new ApiResponse(200, payment, 'Payment verified successfully'));
    } else {
      payment.payment_status = 'FAILED';
      await payment.save();
      throw new ApiError(400, 'Payment verification failed');
    }
  }),
);

export default router;
