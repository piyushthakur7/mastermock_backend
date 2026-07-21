import crypto from 'crypto';
import request from 'supertest';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { Payment } from '../src/models/payment.model.js';
import { Purchase } from '../src/models/purchase.model.js';
import { Enrollment } from '../src/models/enrollment.model.js';
import { Course } from '../src/models/course.model.js';
import { Category } from '../src/models/category.model.js';
import { ensureProvisioned } from '../src/services/payment.service.js';
import { makeUser, makeAdmin, auth } from './helpers.js';

const WEBHOOK_SECRET = 'test_webhook_secret_value';

const makeCourse = async (createdBy, overrides = {}) => {
  const category = await Category.create({ name: `Cat ${Math.random()}` });
  return Course.create({
    title: overrides.title || `Course ${Math.random()}`,
    description: 'A course long enough to satisfy validation',
    price: overrides.price ?? 499,
    access_type: overrides.access_type || 'paid',
    category: category._id,
    created_by: createdBy,
  });
};

const makePendingPayment = (user, item, itemType = 'Course') =>
  Payment.create({
    user: user._id,
    razorpay_order_id: `order_${crypto.randomBytes(6).toString('hex')}`,
    amount: item.price,
    currency: 'INR',
    item_id: item._id,
    item_type: itemType,
    status: 'PENDING',
  });

const signWebhook = (body) =>
  crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(Buffer.from(JSON.stringify(body)))
    .digest('hex');

beforeAll(() => {
  env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

describe('payment provisioning is repairable', () => {
  it('re-grants access for a SUCCESS payment whose provisioning never finished', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const course = await makeCourse(admin.user._id);

    // Exactly the state a crash between "mark SUCCESS" and "create Purchase"
    // used to leave behind: money taken, nothing granted, and — because both
    // verify and status-poll short-circuited on SUCCESS — no way back.
    const payment = await Payment.create({
      user: student.user._id,
      razorpay_order_id: `order_${crypto.randomBytes(6).toString('hex')}`,
      amount: course.price,
      item_id: course._id,
      item_type: 'Course',
      status: 'SUCCESS',
    });

    expect(await Purchase.countDocuments({ user: student.user._id })).toBe(0);

    const repaired = await ensureProvisioned(payment);

    expect(repaired.access_granted_at).toBeTruthy();
    expect(
      await Purchase.countDocuments({
        user: student.user._id,
        item_id: course._id,
        status: 'ACTIVE',
      }),
    ).toBe(1);
    expect(
      await Enrollment.countDocuments({
        user: student.user._id,
        course: course._id,
        status: 'ACTIVE',
      }),
    ).toBe(1);
  });

  it('is idempotent — repeated provisioning never duplicates a purchase', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const course = await makeCourse(admin.user._id);
    const payment = await makePendingPayment(student.user, course);
    await Payment.updateOne(
      { _id: payment._id },
      { $set: { status: 'SUCCESS' } },
    );

    const fresh = await Payment.findById(payment._id);
    await ensureProvisioned(fresh);
    await ensureProvisioned(await Payment.findById(payment._id));
    await ensureProvisioned(await Payment.findById(payment._id));

    expect(
      await Purchase.countDocuments({
        user: student.user._id,
        item_id: course._id,
        status: 'ACTIVE',
      }),
    ).toBe(1);
  });

  it('refuses a second ACTIVE purchase of the same item at the database level', async () => {
    await Purchase.init(); // ensure the partial unique index exists

    const admin = await makeAdmin();
    const student = await makeUser();
    const course = await makeCourse(admin.user._id);
    const payment = await makePendingPayment(student.user, course);

    const base = {
      user: student.user._id,
      item_id: course._id,
      item_type: 'Course',
      payment: payment._id,
      amount: course.price,
      status: 'ACTIVE',
    };

    await Purchase.create(base);
    await expect(Purchase.create(base)).rejects.toMatchObject({ code: 11000 });
  });
});

describe('razorpay webhook', () => {
  it('rejects a payload with a bad signature', async () => {
    const body = { event: 'payment.captured', payload: {} };

    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .set('x-razorpay-signature', 'deadbeef')
      .send(body);

    expect(res.status).toBe(400);
  });

  it('settles a PENDING payment and grants access on payment.captured', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const course = await makeCourse(admin.user._id);
    const payment = await makePendingPayment(student.user, course);

    // The customer closed the tab straight after paying, so neither the client
    // verify call nor the status poll ever fired. Only this can settle it.
    const body = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_test_123',
            order_id: payment.razorpay_order_id,
            status: 'captured',
          },
        },
      },
    };

    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .set('x-razorpay-signature', signWebhook(body))
      .send(body);

    expect(res.status).toBe(200);

    const settled = await Payment.findById(payment._id);
    expect(settled.status).toBe('SUCCESS');
    expect(settled.razorpay_payment_id).toBe('pay_test_123');
    expect(settled.access_granted_at).toBeTruthy();

    expect(
      await Purchase.countDocuments({
        user: student.user._id,
        item_id: course._id,
        status: 'ACTIVE',
      }),
    ).toBe(1);
    expect(
      await Enrollment.countDocuments({
        user: student.user._id,
        course: course._id,
        status: 'ACTIVE',
      }),
    ).toBe(1);
  });

  it('is safe to replay — a duplicate delivery does not double-grant', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const course = await makeCourse(admin.user._id);
    const payment = await makePendingPayment(student.user, course);

    const body = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_test_replay',
            order_id: payment.razorpay_order_id,
            status: 'captured',
          },
        },
      },
    };
    const signature = signWebhook(body);

    for (let i = 0; i < 3; i += 1) {
      const res = await request(app)
        .post('/api/v1/payments/webhook')
        .set('x-razorpay-signature', signature)
        .send(body);
      expect(res.status).toBe(200);
    }

    expect(
      await Purchase.countDocuments({
        user: student.user._id,
        item_id: course._id,
        status: 'ACTIVE',
      }),
    ).toBe(1);
  });

  it('marks a failed payment FAILED without touching a settled one', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const course = await makeCourse(admin.user._id);
    const payment = await makePendingPayment(student.user, course);

    const body = {
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: 'pay_failed_1',
            order_id: payment.razorpay_order_id,
            error_description: 'Card declined',
          },
        },
      },
    };

    await request(app)
      .post('/api/v1/payments/webhook')
      .set('x-razorpay-signature', signWebhook(body))
      .send(body)
      .expect(200);

    const failed = await Payment.findById(payment._id);
    expect(failed.status).toBe('FAILED');
    expect(failed.failure_reason).toBe('Card declined');
    expect(await Purchase.countDocuments({ user: student.user._id })).toBe(0);
  });

  it('revokes access when a full refund arrives', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const course = await makeCourse(admin.user._id);
    const payment = await makePendingPayment(student.user, course);

    const captured = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_refund_me',
            order_id: payment.razorpay_order_id,
            status: 'captured',
          },
        },
      },
    };
    await request(app)
      .post('/api/v1/payments/webhook')
      .set('x-razorpay-signature', signWebhook(captured))
      .send(captured)
      .expect(200);

    const refund = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: 'rfnd_1',
            payment_id: 'pay_refund_me',
            amount: course.price * 100,
          },
        },
      },
    };
    await request(app)
      .post('/api/v1/payments/webhook')
      .set('x-razorpay-signature', signWebhook(refund))
      .send(refund)
      .expect(200);

    // REFUNDED existed in the enum but nothing in the codebase could set it.
    const refunded = await Payment.findById(payment._id);
    expect(refunded.status).toBe('REFUNDED');
    expect(refunded.refunded_at).toBeTruthy();

    expect(
      await Purchase.countDocuments({
        user: student.user._id,
        item_id: course._id,
        status: 'ACTIVE',
      }),
    ).toBe(0);
    expect(
      await Enrollment.countDocuments({
        user: student.user._id,
        course: course._id,
        status: 'ACTIVE',
      }),
    ).toBe(0);
  });
});

describe('payment ownership', () => {
  it("does not let one student read another's payment status", async () => {
    const admin = await makeAdmin();
    const owner = await makeUser();
    const stranger = await makeUser();
    const course = await makeCourse(admin.user._id);
    const payment = await makePendingPayment(owner.user, course);

    const res = await request(app)
      .get(`/api/v1/payments/status/${payment.razorpay_order_id}`)
      .set(auth(stranger.token));

    expect(res.status).toBe(403);
  });
});
