import Razorpay from 'razorpay';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { Payment } from '../models/payment.model.js';
import { Purchase } from '../models/purchase.model.js';
import { Course } from '../models/course.model.js';
import { Hack } from '../models/hack.model.js';
import { Resource } from '../models/resource.model.js';
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

/** Constant-time compare of two hex digests, tolerant of malformed input. */
const safeCompareHex = (expectedHex, providedHex) => {
  const expected = Buffer.from(expectedHex, 'hex');
  const provided = Buffer.from(
    typeof providedHex === 'string' ? providedHex : '',
    'hex',
  );
  if (!expected.length || expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
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
  } else if (itemType === 'Hack') {
    item = await Hack.findOne({
      _id: itemId,
      isDeleted: false,
      is_active: true,
    });
  } else if (itemType === 'Resource') {
    item = await Resource.findOne({
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

// ═══════════════════════════════════════════════════════════════════════
// ACCESS PROVISIONING
// ═══════════════════════════════════════════════════════════════════════

/**
 * Grant access for a paid payment. Idempotent and safe to re-run.
 *
 * Both writes are upserts rather than findOne-then-create: the old version
 * raced with itself (nothing serialised the check against the insert) and
 * relied on a duplicate-key catch that could never fire, because Purchase had
 * no unique index. Concurrent verify / webhook / poll paths therefore each
 * inserted their own row.
 *
 * `access_granted_at` is stamped last. Until it is set the payment counts as
 * "paid but not provisioned", and every read path re-runs this — which is what
 * makes a crash between the two writes recoverable.
 */
const grantAccess = async (payment) => {
  const userId = payment.user;

  try {
    await Purchase.updateOne(
      {
        user: userId,
        item_id: payment.item_id,
        item_type: payment.item_type,
        status: 'ACTIVE',
      },
      {
        $setOnInsert: {
          payment: payment._id,
          amount: payment.amount,
          purchase_date: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    // Two concurrent upserts can still collide against the partial unique
    // index; the loser's row already exists, which is the end state we want.
    if (error?.code !== 11000) throw error;
  }

  if (payment.item_type === 'Course') {
    try {
      await Enrollment.updateOne(
        { user: userId, course: payment.item_id },
        {
          // $set (not $setOnInsert) so re-purchasing after a refund
          // reactivates the revoked enrolment instead of leaving it dead.
          $set: { status: 'ACTIVE' },
          $setOnInsert: { enrolled_at: new Date() },
        },
        { upsert: true },
      );
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
  }

  await Payment.updateOne(
    { _id: payment._id },
    { $set: { access_granted_at: new Date() } },
  );

  logger.info(
    `Access provisioned: payment=${payment._id} user=${userId} item=${payment.item_id} type=${payment.item_type}`,
  );
};

/**
 * Repair a payment whose money was taken but whose access was never granted.
 *
 * Previously both verifyPayment and getPaymentStatus short-circuited the
 * moment status was SUCCESS, so a crash between "mark SUCCESS" and "create
 * Purchase" left the customer permanently paid-but-locked-out with no code
 * path able to fix it.
 */
export const ensureProvisioned = async (payment) => {
  if (!payment || payment.status !== 'SUCCESS') return payment;
  if (payment.access_granted_at) return payment;

  logger.warn(
    `Repairing unprovisioned payment=${payment._id} order=${payment.razorpay_order_id}`,
  );
  await grantAccess(payment);
  return (await Payment.findById(payment._id)) || payment;
};

/** Revoke access after a full refund. */
const revokeAccess = async (payment) => {
  await Purchase.updateMany(
    {
      user: payment.user,
      item_id: payment.item_id,
      item_type: payment.item_type,
      status: 'ACTIVE',
    },
    { $set: { status: 'REFUNDED' } },
  );

  if (payment.item_type === 'Course') {
    await Enrollment.updateOne(
      { user: payment.user, course: payment.item_id },
      { $set: { status: 'REVOKED' } },
    );
  }

  logger.info(
    `Access revoked after refund: payment=${payment._id} user=${payment.user} item=${payment.item_id}`,
  );
};

/**
 * Move a payment to SUCCESS and provision access. Safe to call repeatedly and
 * from several paths at once (client verify, status poll, webhook).
 */
const markSuccess = async (payment, razorpayPaymentId, extra = {}) => {
  const updated = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $in: ['PENDING', 'SUCCESS'] } },
    {
      $set: {
        status: 'SUCCESS',
        ...(razorpayPaymentId
          ? { razorpay_payment_id: razorpayPaymentId }
          : {}),
        ...extra,
      },
    },
    { new: true },
  );

  if (!updated) {
    // Terminal state (FAILED / CANCELLED / REFUNDED) — do not resurrect it.
    return Payment.findById(payment._id);
  }

  if (!updated.access_granted_at) {
    await grantAccess(updated);
    return (await Payment.findById(updated._id)) || updated;
  }

  return updated;
};

/**
 * Ask Razorpay what actually happened to a PENDING order.
 *
 * This is the server-side reconciliation path: if the customer closed the tab
 * straight after paying, neither the client verify call nor the modal-dismiss
 * poll ever fires, and only this (or the webhook) can settle the record.
 */
const reconcilePendingPayment = async (payment) => {
  if (!payment || payment.status !== 'PENDING') return payment;

  let razorpay;
  try {
    razorpay = getRazorpay();
  } catch {
    return payment;
  }

  try {
    const rzpOrder = await razorpay.orders.fetch(payment.razorpay_order_id);
    if (!rzpOrder) return payment;

    if (rzpOrder.status === 'paid') {
      const payments = await razorpay.orders.fetchPayments(
        payment.razorpay_order_id,
      );
      // Only a CAPTURED payment is money in the bank. An authorized-but-
      // uncaptured payment can still expire or be voided, and granting access
      // on it handed out product for money never collected.
      const captured = payments?.items?.find((p) => p.status === 'captured');
      if (captured) {
        return markSuccess(payment, captured.id);
      }
      return payment;
    }

    if (rzpOrder.status === 'attempted') {
      const payments = await razorpay.orders.fetchPayments(
        payment.razorpay_order_id,
      );
      const captured = payments?.items?.find((p) => p.status === 'captured');
      if (captured) return markSuccess(payment, captured.id);
    }

    return payment;
  } catch (error) {
    logger.error(
      `Reconciliation failed for order=${payment.razorpay_order_id}: ${error.message}`,
    );
    return payment;
  }
};

// ═══════════════════════════════════════════════════════════════════════
// 1. CREATE ORDER
// ═══════════════════════════════════════════════════════════════════════
export const createOrder = async (userId, itemId, itemType) => {
  const item = await lookupItem(itemId, itemType);
  const amount = item.price;

  const existingPurchase = await Purchase.findOne({
    user: userId,
    item_id: itemId,
    item_type: itemType,
    status: 'ACTIVE',
  });

  if (existingPurchase) {
    throw new ApiError(
      400,
      'You have already purchased this item. Paid mock tests can only be attempted once.',
    );
  }

  // Reuse ANY open order for this item, with no time window.
  //
  // The old five-minute window meant a customer who left the Razorpay modal
  // open for six minutes and then clicked Buy again got a *second* live order
  // for the same item. Paying both charged them twice, granted one purchase,
  // and left the rest unrecoverable because no refund path existed.
  const existingPending = await Payment.findOne({
    user: userId,
    item_id: itemId,
    item_type: itemType,
    status: 'PENDING',
  });

  if (existingPending) {
    const reconciled = await reconcilePendingPayment(existingPending);

    if (reconciled.status === 'SUCCESS') {
      throw new ApiError(
        400,
        'You have already purchased this item. Paid mock tests can only be attempted once.',
      );
    }

    if (reconciled.status === 'PENDING') {
      logger.info(
        `Reusing open order=${reconciled.razorpay_order_id} for user=${userId} item=${itemId}`,
      );
      return {
        order_id: reconciled.razorpay_order_id,
        // Must match the paise amount the order was actually created with.
        amount: Math.round(reconciled.amount * 100),
        currency: reconciled.currency,
        key_id: env.RAZORPAY_KEY_ID,
      };
    }
    // Otherwise it settled as FAILED/CANCELLED — the PENDING slot is free.
  }

  const razorpay = getRazorpay();
  const amountInPaise = Math.round(amount * 100);

  let order;
  try {
    order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `receipt_${Date.now()}_${userId.toString().slice(-6)}`,
      notes: {
        user_id: userId.toString(),
        item_id: itemId.toString(),
        item_type: itemType,
      },
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

  try {
    await Payment.create({
      user: userId,
      razorpay_order_id: order.id,
      amount,
      currency: 'INR',
      item_id: itemId,
      item_type: itemType,
      status: 'PENDING',
    });
  } catch (error) {
    // Lost a race against a concurrent create-order for the same item; the
    // winner's order is equally valid, so hand that one back.
    if (error?.code === 11000) {
      const winner = await Payment.findOne({
        user: userId,
        item_id: itemId,
        item_type: itemType,
        status: 'PENDING',
      });
      if (winner) {
        return {
          order_id: winner.razorpay_order_id,
          amount: Math.round(winner.amount * 100),
          currency: winner.currency,
          key_id: env.RAZORPAY_KEY_ID,
        };
      }
    }
    throw error;
  }

  logger.info(
    `Order created: ${order.id} for user=${userId}, item=${itemId}, amount=${amount}`,
  );

  return {
    order_id: order.id,
    amount: amountInPaise,
    currency: 'INR',
    key_id: env.RAZORPAY_KEY_ID,
  };
};

// ═══════════════════════════════════════════════════════════════════════
// 2. GET PAYMENT STATUS
// ═══════════════════════════════════════════════════════════════════════
export const getPaymentStatus = async (userId, razorpayOrderId) => {
  const payment = await Payment.findOne({ razorpay_order_id: razorpayOrderId });

  if (!payment) {
    throw new ApiError(404, 'Payment order not found');
  }

  if (payment.user.toString() !== userId.toString()) {
    throw new ApiError(
      403,
      'Unauthorized: payment does not belong to this user',
    );
  }

  // PENDING → ask Razorpay. SUCCESS → make sure provisioning actually
  // finished; this branch used to be skipped entirely, which is what made a
  // half-provisioned payment permanent.
  let current = payment;
  if (current.status === 'PENDING') {
    current = await reconcilePendingPayment(current);
  }
  current = await ensureProvisioned(current);

  return {
    status: current.status,
    order_id: current.razorpay_order_id,
    payment_id: current.razorpay_payment_id,
    access_granted: Boolean(current.access_granted_at),
  };
};

// ═══════════════════════════════════════════════════════════════════════
// 3. VERIFY PAYMENT (client-side accelerator)
// ═══════════════════════════════════════════════════════════════════════
export const verifyPayment = async (
  userId,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
) => {
  const payment = await Payment.findOne({ razorpay_order_id: razorpayOrderId });

  if (!payment) {
    throw new ApiError(404, 'Payment order not found');
  }

  // Ownership check first, so this cannot be used to read back someone else's
  // payment by guessing an order id.
  if (payment.user.toString() !== userId.toString()) {
    throw new ApiError(
      403,
      'Unauthorized: payment does not belong to this user',
    );
  }

  // Already settled (webhook or poll got there first) — but still make sure
  // access was actually provisioned before returning.
  if (payment.status === 'SUCCESS') {
    logger.info(`Payment already verified: order=${razorpayOrderId}`);
    return ensureProvisioned(payment);
  }

  if (!env.RAZORPAY_KEY_SECRET) {
    throw new ApiError(500, 'Razorpay key secret is not configured');
  }

  const expectedSignature = crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  if (!safeCompareHex(expectedSignature, razorpaySignature)) {
    logger.warn(
      `Invalid payment signature for order=${razorpayOrderId} user=${userId}`,
    );
    throw new ApiError(400, 'Payment verification failed: invalid signature');
  }

  const updated = await markSuccess(payment, razorpayPaymentId, {
    razorpay_signature: razorpaySignature,
  });

  if (!updated || updated.status !== 'SUCCESS') {
    throw new ApiError(400, 'Payment could not be verified (invalid status)');
  }

  logger.info(`Payment verified: order=${razorpayOrderId} user=${userId}`);
  return updated;
};

// ═══════════════════════════════════════════════════════════════════════
// 4. WEBHOOK
// ═══════════════════════════════════════════════════════════════════════

/**
 * Handle a Razorpay webhook.
 *
 * This is the only reconciliation path that does not depend on the customer's
 * browser still being open. Without it, a tab closed immediately after payment
 * left the Payment row PENDING forever.
 *
 * Returns a summary instead of throwing for unknown orders/events: Razorpay
 * retries any non-2xx for hours, so unrecognised-but-well-formed events must
 * still be acknowledged.
 */
export const handleWebhookEvent = async (rawBody, signature) => {
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    throw new ApiError(500, 'Razorpay webhook secret is not configured');
  }
  if (!rawBody || !rawBody.length) {
    throw new ApiError(400, 'Empty webhook body');
  }

  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  if (!safeCompareHex(expected, signature)) {
    logger.warn('Rejected Razorpay webhook: invalid signature');
    throw new ApiError(400, 'Invalid webhook signature');
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new ApiError(400, 'Malformed webhook payload');
  }

  const type = event?.event;
  const paymentEntity = event?.payload?.payment?.entity;
  const refundEntity = event?.payload?.refund?.entity;
  const orderEntity = event?.payload?.order?.entity;

  const findByOrder = async (orderId) => {
    if (!orderId) return null;
    return Payment.findOne({ razorpay_order_id: orderId });
  };

  switch (type) {
    case 'order.paid':
    case 'payment.captured': {
      const orderId = paymentEntity?.order_id || orderEntity?.id;
      const payment = await findByOrder(orderId);
      if (!payment) {
        logger.warn(`Webhook ${type} for unknown order=${orderId}`);
        return { handled: false, reason: 'unknown_order' };
      }
      await markSuccess(payment, paymentEntity?.id);
      logger.info(`Webhook ${type} settled order=${orderId}`);
      return { handled: true, event: type };
    }

    case 'payment.failed': {
      const orderId = paymentEntity?.order_id;
      const payment = await findByOrder(orderId);
      if (!payment) return { handled: false, reason: 'unknown_order' };

      // Only a still-open order may be failed; never downgrade a settled one.
      await Payment.updateOne(
        { _id: payment._id, status: 'PENDING' },
        {
          $set: {
            status: 'FAILED',
            failure_reason:
              paymentEntity?.error_description || 'Payment failed at gateway',
            ...(paymentEntity?.id
              ? { razorpay_payment_id: paymentEntity.id }
              : {}),
          },
        },
      );
      logger.info(`Webhook payment.failed marked order=${orderId} FAILED`);
      return { handled: true, event: type };
    }

    case 'refund.created':
    case 'refund.processed': {
      const orderId = refundEntity?.notes?.order_id || paymentEntity?.order_id;
      let payment = await findByOrder(orderId);

      if (!payment && refundEntity?.payment_id) {
        payment = await Payment.findOne({
          razorpay_payment_id: refundEntity.payment_id,
        });
      }
      if (!payment) {
        logger.warn(`Webhook ${type} for unknown payment`);
        return { handled: false, reason: 'unknown_payment' };
      }

      const refundAmount = refundEntity?.amount
        ? refundEntity.amount / 100
        : payment.amount;
      const isFullRefund = refundAmount >= payment.amount;

      const updated = await Payment.findByIdAndUpdate(
        payment._id,
        {
          $set: {
            ...(isFullRefund ? { status: 'REFUNDED' } : {}),
            razorpay_refund_id: refundEntity?.id,
            refund_amount: refundAmount,
            refunded_at: new Date(),
            refund_reason:
              refundEntity?.notes?.reason || 'Refunded at the gateway',
          },
        },
        { new: true },
      );

      if (isFullRefund && updated) await revokeAccess(updated);
      logger.info(`Webhook ${type} processed for payment=${payment._id}`);
      return { handled: true, event: type };
    }

    default:
      return { handled: false, reason: 'ignored', event: type };
  }
};

// ═══════════════════════════════════════════════════════════════════════
// 5. REFUND (admin)
// ═══════════════════════════════════════════════════════════════════════
export const refundPayment = async (paymentId, { amount, reason, actorId }) => {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new ApiError(404, 'Payment not found');

  if (payment.status === 'REFUNDED') {
    throw new ApiError(400, 'This payment has already been refunded');
  }
  if (payment.status !== 'SUCCESS') {
    throw new ApiError(400, 'Only a successful payment can be refunded');
  }
  if (!payment.razorpay_payment_id) {
    throw new ApiError(
      400,
      'This payment has no gateway payment id and cannot be refunded automatically',
    );
  }

  const refundAmount = amount != null ? Number(amount) : payment.amount;
  if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
    throw new ApiError(400, 'Refund amount must be greater than zero');
  }
  if (refundAmount > payment.amount) {
    throw new ApiError(
      400,
      'Refund amount cannot exceed the amount originally paid',
    );
  }

  const razorpay = getRazorpay();
  let refund;
  try {
    refund = await razorpay.payments.refund(payment.razorpay_payment_id, {
      amount: Math.round(refundAmount * 100),
      speed: 'normal',
      notes: {
        reason: reason || 'Refund issued by admin',
        order_id: payment.razorpay_order_id,
        actor: actorId ? String(actorId) : 'system',
      },
    });
  } catch (error) {
    logger.error(
      `Razorpay refund failed for payment=${payment._id}: ${error.message}`,
    );
    throw new ApiError(502, 'The payment provider rejected the refund request');
  }

  const isFullRefund = refundAmount >= payment.amount;

  const updated = await Payment.findByIdAndUpdate(
    payment._id,
    {
      $set: {
        ...(isFullRefund ? { status: 'REFUNDED' } : {}),
        razorpay_refund_id: refund?.id,
        refund_amount: refundAmount,
        refunded_at: new Date(),
        refund_reason: reason || 'Refund issued by admin',
      },
    },
    { new: true },
  );

  if (isFullRefund) await revokeAccess(updated);

  logger.info(
    `Refund ${refund?.id} of ${refundAmount} issued for payment=${payment._id} by actor=${actorId}`,
  );

  return updated;
};

// ═══════════════════════════════════════════════════════════════════════
// 6. BACKGROUND RECONCILIATION
// ═══════════════════════════════════════════════════════════════════════

/**
 * Settle payments that no browser is going to settle for us:
 *   1. SUCCESS payments whose access provisioning never completed.
 *   2. PENDING payments old enough that the customer has clearly gone away.
 *
 * Together with the webhook this removes the dependency on the client
 * finishing its verify call.
 */
export const reconcileStalePayments = async ({
  pendingOlderThanMinutes = 10,
  limit = 50,
} = {}) => {
  const summary = { repaired: 0, settled: 0, checked: 0 };

  const unprovisioned = await Payment.find({
    status: 'SUCCESS',
    access_granted_at: { $exists: false },
  }).limit(limit);

  for (const payment of unprovisioned) {
    try {
      await ensureProvisioned(payment);
      summary.repaired += 1;
    } catch (error) {
      logger.error(
        `Failed to repair provisioning for payment=${payment._id}: ${error.message}`,
      );
    }
  }

  const cutoff = new Date(Date.now() - pendingOlderThanMinutes * 60 * 1000);
  const stalePending = await Payment.find({
    status: 'PENDING',
    createdAt: { $lte: cutoff },
  }).limit(limit);

  for (const payment of stalePending) {
    try {
      summary.checked += 1;
      const result = await reconcilePendingPayment(payment);
      if (result.status === 'SUCCESS') summary.settled += 1;
    } catch (error) {
      logger.error(
        `Failed to reconcile payment=${payment._id}: ${error.message}`,
      );
    }
  }

  if (summary.repaired || summary.settled) {
    logger.info(
      `Payment reconciliation: repaired=${summary.repaired} settled=${summary.settled} checked=${summary.checked}`,
    );
  }

  return summary;
};

// ═══════════════════════════════════════════════════════════════════════
// 7. READS
// ═══════════════════════════════════════════════════════════════════════
export const getMyPurchases = async (userId) => {
  return Purchase.find({ user: userId, status: 'ACTIVE' })
    .populate('item_id')
    .sort({ createdAt: -1 });
};

export const getMyHistory = async (userId) => {
  return Payment.find({ user: userId }).sort({ createdAt: -1 });
};

export const getAllPurchases = async ({ page = 1, limit = 50 } = {}) => {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const skip = (safePage - 1) * safeLimit;

  const [items, total] = await Promise.all([
    Purchase.find()
      .populate('user', 'full_name email')
      .populate('item_id')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit),
    Purchase.countDocuments(),
  ]);

  return {
    items,
    total,
    page: safePage,
    limit: safeLimit,
    total_pages: Math.ceil(total / safeLimit) || 1,
  };
};
