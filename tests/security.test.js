import request from 'supertest';
import app from '../src/app.js';
import { Payment } from '../src/models/payment.model.js';
import { User } from '../src/models/user.model.js';
import { makeUser, makeAdmin, makeHack, auth } from './helpers.js';

describe('payment ownership (IDOR)', () => {
  it("does not let one user read back another user's SUCCESS payment", async () => {
    const victim = await makeUser();
    const attacker = await makeUser();

    const payment = await Payment.create({
      user: victim.user._id,
      razorpay_order_id: 'order_victim_123',
      amount: 499,
      currency: 'INR',
      item_id: victim.user._id, // stand-in item
      item_type: 'Hack',
      status: 'SUCCESS',
      razorpay_payment_id: 'pay_secret_abc',
    });

    const res = await request(app)
      .post('/api/v1/payments/verify')
      .set(auth(attacker.token))
      .send({
        razorpay_order_id: 'order_victim_123',
        razorpay_payment_id: 'pay_secret_abc',
        razorpay_signature: 'deadbeef',
      });

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('pay_secret_abc');

    // and the record is untouched
    const after = await Payment.findById(payment._id);
    expect(after.status).toBe('SUCCESS');
  });
});

describe('admin login does not leak which accounts are admins', () => {
  it('returns 401 (not 403) for a non-admin when the password is wrong', async () => {
    const student = await makeUser({ role: 'STUDENT' });

    const res = await request(app)
      .post('/api/v1/auth/admin-login')
      .send({ email: student.user.email, password: 'WrongPassword9!' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid credentials');
  });

  it('still refuses a non-admin who supplies the correct password', async () => {
    const student = await makeUser({ role: 'STUDENT' });

    const res = await request(app)
      .post('/api/v1/auth/admin-login')
      .send({ email: student.user.email, password: student.password });

    expect(res.status).toBe(403);
  });

  it('lets a real admin in', async () => {
    const admin = await makeAdmin();

    const res = await request(app)
      .post('/api/v1/auth/admin-login')
      .send({ email: admin.user.email, password: admin.password });

    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('ADMIN');
  });
});

describe('forgot-password does not confirm whether an email is registered', () => {
  it('answers identically for known and unknown addresses', async () => {
    const known = await makeUser();

    const a = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: known.user.email });
    const b = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'definitely-not-registered@example.com' });

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.message).toBe(b.body.message);
  });
});

describe('student-facing hack payloads', () => {
  it('omits created_by and correct answers for anonymous callers', async () => {
    const admin = await makeAdmin();
    await makeHack(admin.user._id);

    const res = await request(app).get('/api/v1/hacks');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);

    const hack = res.body.data[0];
    expect(hack.created_by).toBeUndefined();
    for (const option of hack.questions[0].options) {
      expect(option.is_correct).toBeUndefined();
    }
  });

  it('still gives admins created_by and the answer key', async () => {
    const admin = await makeAdmin();
    await makeHack(admin.user._id);

    const res = await request(app).get('/api/v1/hacks').set(auth(admin.token));

    expect(res.status).toBe(200);
    const hack = res.body.data[0];
    expect(hack.created_by).toBeDefined();
    expect(hack.questions[0].options.some((o) => o.is_correct)).toBe(true);
  });
});

describe('suspended accounts', () => {
  it('reports 403, not 401', async () => {
    const { user, token } = await makeUser();
    await User.findByIdAndUpdate(user._id, { status: 'suspended' });

    const res = await request(app).get('/api/v1/users/me').set(auth(token));

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/suspended/i);
  });
});
