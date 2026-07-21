import request from 'supertest';
import fs from 'fs';
import path from 'path';
import app from '../src/app.js';
import { Resource } from '../src/models/resource.model.js';
import { Purchase } from '../src/models/purchase.model.js';
import { Payment } from '../src/models/payment.model.js';
import { TestAttempt } from '../src/models/testAttempt.model.js';
import { Enrollment } from '../src/models/enrollment.model.js';
import { Inquiry } from '../src/models/inquiry.model.js';
import { Course } from '../src/models/course.model.js';
import { Category } from '../src/models/category.model.js';
import { makeUser, makeAdmin, makeHack, auth } from './helpers.js';

const makePaidResource = async (createdBy, overrides = {}) =>
  Resource.create({
    title: overrides.title || 'Paid Notes',
    resource_type: 'pdf',
    access_type: overrides.access_type || 'paid',
    price: overrides.price ?? 199,
    file_url: overrides.file_url || 'resources/standalone/test.pdf',
    created_by: createdBy,
    course: overrides.course,
  });

describe('resource downloads are access-gated', () => {
  it('refuses a paid resource to a student who has not bought it', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const resource = await makePaidResource(admin.user._id);

    // Any logged-in student could previously list the paid catalogue with
    // ?access_type=paid and then download every item — the handler read
    // access_type nowhere.
    const res = await request(app)
      .get(`/api/v1/resources/${resource._id}/download`)
      .set(auth(student.token));

    expect(res.status).toBe(403);
  });

  it('allows a student who purchased it past the access gate', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const resource = await makePaidResource(admin.user._id);

    const payment = await Payment.create({
      user: student.user._id,
      razorpay_order_id: `order_${Date.now()}`,
      amount: resource.price,
      item_id: resource._id,
      item_type: 'Resource',
      status: 'SUCCESS',
    });
    await Purchase.create({
      user: student.user._id,
      item_id: resource._id,
      item_type: 'Resource',
      payment: payment._id,
      amount: resource.price,
      status: 'ACTIVE',
    });

    const res = await request(app)
      .get(`/api/v1/resources/${resource._id}/download`)
      .set(auth(student.token));

    // Gating passes. The placeholder file does not exist on disk, so this
    // lands on the missing-file path rather than being refused as unpaid.
    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('FILE_MISSING');
  });

  it('allows a student enrolled in the parent course', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const category = await Category.create({ name: `Cat ${Date.now()}` });
    const course = await Course.create({
      title: 'Bundled Course',
      description: 'Long enough description here',
      price: 0,
      access_type: 'free',
      category: category._id,
      created_by: admin.user._id,
    });
    const resource = await makePaidResource(admin.user._id, {
      course: course._id,
    });

    await Enrollment.create({
      user: student.user._id,
      course: course._id,
      status: 'ACTIVE',
    });

    const res = await request(app)
      .get(`/api/v1/resources/${resource._id}/download`)
      .set(auth(student.token));

    expect(res.status).not.toBe(403);
  });

  it('serves a free resource to any logged-in student', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const resource = await makePaidResource(admin.user._id, {
      access_type: 'free',
      price: 0,
    });

    const res = await request(app)
      .get(`/api/v1/resources/${resource._id}/download`)
      .set(auth(student.token));

    expect(res.status).not.toBe(403);
  });
});

describe('uploaded filenames cannot escape the uploads directory', () => {
  it('strips traversal sequences from the client-supplied filename', async () => {
    const admin = await makeAdmin();

    const res = await request(app)
      .post('/api/v1/resources')
      .set(auth(admin.token))
      .field('title', 'Traversal Attempt')
      .field('resource_type', 'pdf')
      .attach('file', Buffer.from('%PDF-1.4 test'), {
        filename: '../../../../evil.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(201);

    const storedPath = res.body.data.file_url;
    expect(storedPath).not.toContain('..');

    // And the bytes really did land inside uploads/.
    const resolved = path.resolve(process.cwd(), 'uploads', storedPath);
    const uploadRoot = path.resolve(process.cwd(), 'uploads');
    expect(resolved.startsWith(uploadRoot + path.sep)).toBe(true);

    if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
  });
});

describe('checkAccess lets a student resume a live attempt', () => {
  it('does not report a paid test as exhausted while an attempt is in progress', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await makeHack(admin.user._id, {
      access_type: 'paid',
      price: 99,
    });

    const payment = await Payment.create({
      user: student.user._id,
      razorpay_order_id: `order_${Date.now()}`,
      amount: 99,
      item_id: hack._id,
      item_type: 'Hack',
      status: 'SUCCESS',
    });
    await Purchase.create({
      user: student.user._id,
      item_id: hack._id,
      item_type: 'Hack',
      payment: payment._id,
      amount: 99,
      status: 'ACTIVE',
    });

    const started = await request(app)
      .post('/api/v1/attempts/start')
      .set(auth(student.token))
      .send({ hack_id: hack._id.toString() });
    expect(started.status).toBe(201);

    // Simulates a page refresh mid-exam. This used to answer
    // "already attempted", locking the student out of their own paper even
    // though /attempts/start would have handed the live attempt straight back.
    const res = await request(app)
      .get(`/api/v1/hacks/${hack._id}/check-access`)
      .set(auth(student.token))
      .expect(200);

    expect(res.body.data.has_access).toBe(true);
    expect(res.body.data.attempt_exhausted).toBe(false);
    expect(res.body.data.has_active_attempt).toBe(true);
    expect(res.body.data.active_attempt_id).toBe(started.body.data._id);
  });
});

describe('attempt submission is idempotent', () => {
  it('returns the finalized attempt instead of 404 on a duplicate submit', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await makeHack(admin.user._id);

    const started = await request(app)
      .post('/api/v1/attempts/start')
      .set(auth(student.token))
      .send({ hack_id: hack._id.toString() });
    const attemptId = started.body.data._id;

    const first = await request(app)
      .post(`/api/v1/attempts/${attemptId}/submit`)
      .set(auth(student.token));
    expect(first.status).toBe(200);

    // A double-clicked submit button, or a submit racing the auto-submit
    // sweeper, used to 404 because the query required status IN_PROGRESS.
    const second = await request(app)
      .post(`/api/v1/attempts/${attemptId}/submit`)
      .set(auth(student.token));
    expect(second.status).toBe(200);
    expect(second.body.data.status).toBe('COMPLETED');
  });

  it('records an expired attempt as finishing at its deadline, not on submit', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await makeHack(admin.user._id);

    const started = await request(app)
      .post('/api/v1/attempts/start')
      .set(auth(student.token))
      .send({ hack_id: hack._id.toString() });
    const attemptId = started.body.data._id;

    const deadline = new Date(Date.now() - 60 * 1000);
    await TestAttempt.updateOne(
      { _id: attemptId },
      { $set: { expires_at: deadline } },
    );

    await request(app)
      .post(`/api/v1/attempts/${attemptId}/submit`)
      .set(auth(student.token))
      .expect(200);

    const attempt = await TestAttempt.findById(attemptId);
    expect(attempt.status).toBe('COMPLETED');
    expect(attempt.completed_at.getTime()).toBe(deadline.getTime());
  });
});

describe('scheduled window boundaries', () => {
  it('refuses a start at exactly the closing instant', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const closesNow = new Date(Date.now() + 150);
    const hack = await makeHack(admin.user._id, { end_time: closesNow });

    await new Promise((resolve) => setTimeout(resolve, 250));

    const res = await request(app)
      .post('/api/v1/attempts/start')
      .set(auth(student.token))
      .send({ hack_id: hack._id.toString() });

    expect(res.status).toBe(403);
  });

  it('never lets an attempt run past the window close', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    // A 90-minute test with 4.2 minutes of window left. Math.ceil() used to
    // round that up to 5 whole minutes, overrunning the close by 48 seconds.
    const endTime = new Date(Date.now() + 4.2 * 60 * 1000);
    const hack = await makeHack(admin.user._id, {
      duration_minutes: 90,
      end_time: endTime,
    });

    const res = await request(app)
      .post('/api/v1/attempts/start')
      .set(auth(student.token))
      .send({ hack_id: hack._id.toString() })
      .expect(201);

    expect(new Date(res.body.data.expires_at).getTime()).toBe(
      endTime.getTime(),
    );
  });
});

describe('leaderboard tie handling', () => {
  it('gives tied students the same rank, and my-rank agrees with the board', async () => {
    const admin = await makeAdmin();
    const alice = await makeUser();
    const bob = await makeUser();
    const carol = await makeUser();
    const hack = await makeHack(admin.user._id);

    const attempt = (user, score, minutesAgo) =>
      TestAttempt.create({
        user: user.user._id,
        hack: hack._id,
        status: 'COMPLETED',
        score,
        percentage: score * 50,
        completed_at: new Date(Date.now() - minutesAgo * 60000),
        answers: [],
      });

    await attempt(alice, 2, 30);
    await attempt(bob, 2, 10); // same score, finished later
    await attempt(carol, 1, 20);

    const board = await request(app)
      .get(`/api/v1/leaderboard/${hack._id}`)
      .set(auth(alice.token))
      .expect(200);

    const entries = board.body.data.entries;
    expect(entries).toHaveLength(3);

    // Joint first, then third — not first/second/third.
    expect(entries[0].rank).toBe(1);
    expect(entries[1].rank).toBe(1);
    expect(entries[2].rank).toBe(3);

    // Earlier finisher listed first within the tie.
    expect(entries[0].user._id).toBe(alice.user._id.toString());

    for (const [user, expectedRank] of [
      [alice, 1],
      [bob, 1],
      [carol, 3],
    ]) {
      const mine = await request(app)
        .get(`/api/v1/leaderboard/${hack._id}/my-rank`)
        .set(auth(user.token))
        .expect(200);
      expect(mine.body.data.rank).toBe(expectedRank);
      expect(mine.body.data.total_participants).toBe(3);
    }
  });
});

describe('deleting a user cleans up what pointed at them', () => {
  it('removes attempts, enrolments and inquiries, and expires purchases', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await makeHack(admin.user._id);
    const category = await Category.create({ name: `Cat ${Date.now()}` });
    const course = await Course.create({
      title: 'Some Course',
      description: 'Long enough description here',
      price: 0,
      access_type: 'free',
      category: category._id,
      created_by: admin.user._id,
    });

    await TestAttempt.create({
      user: student.user._id,
      hack: hack._id,
      status: 'COMPLETED',
      score: 2,
      completed_at: new Date(),
      answers: [],
    });
    await Enrollment.create({
      user: student.user._id,
      course: course._id,
      status: 'ACTIVE',
    });
    await Inquiry.create({
      student: student.user._id,
      subject: 'Help',
      message: 'Please help me',
    });
    const payment = await Payment.create({
      user: student.user._id,
      razorpay_order_id: `order_${Date.now()}`,
      amount: 100,
      item_id: hack._id,
      item_type: 'Hack',
      status: 'SUCCESS',
    });
    await Purchase.create({
      user: student.user._id,
      item_id: hack._id,
      item_type: 'Hack',
      payment: payment._id,
      amount: 100,
      status: 'ACTIVE',
    });

    await request(app)
      .delete(`/api/v1/users/${student.user._id}`)
      .set(auth(admin.token))
      .expect(200);

    expect(await TestAttempt.countDocuments({ user: student.user._id })).toBe(
      0,
    );
    expect(await Enrollment.countDocuments({ user: student.user._id })).toBe(0);
    expect(await Inquiry.countDocuments({ student: student.user._id })).toBe(0);
    // Financial records survive for audit, but access is withdrawn.
    expect(await Payment.countDocuments({ user: student.user._id })).toBe(1);
    expect(
      await Purchase.countDocuments({
        user: student.user._id,
        status: 'ACTIVE',
      }),
    ).toBe(0);
  });

  it('refuses to let an admin delete their own account', async () => {
    const admin = await makeAdmin();

    const res = await request(app)
      .delete(`/api/v1/users/${admin.user._id}`)
      .set(auth(admin.token));

    expect(res.status).toBe(400);
  });
});

describe('inquiries support a full thread', () => {
  it('keeps every reply instead of overwriting the last one', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();

    const created = await request(app)
      .post('/api/v1/inquiries')
      .set(auth(student.token))
      .send({ subject: 'Billing question', message: 'I was charged twice' })
      .expect(201);

    const inquiryId = created.body.data._id;

    await request(app)
      .post(`/api/v1/inquiries/${inquiryId}/reply`)
      .set(auth(admin.token))
      .send({ message: 'Looking into it now' })
      .expect(200);

    await request(app)
      .post(`/api/v1/inquiries/${inquiryId}/reply`)
      .set(auth(student.token))
      .send({ message: 'Thank you, here is my order id' })
      .expect(200);

    const final = await request(app)
      .post(`/api/v1/inquiries/${inquiryId}/reply`)
      .set(auth(admin.token))
      .send({ message: 'Refund issued', status: 'RESOLVED' })
      .expect(200);

    // The model had a single admin_reply string, so reply #3 used to be the
    // only one that survived.
    expect(final.body.data.replies).toHaveLength(3);
    expect(final.body.data.replies.map((r) => r.author_role)).toEqual([
      'ADMIN',
      'STUDENT',
      'ADMIN',
    ]);
    expect(final.body.data.status).toBe('RESOLVED');
  });

  it('rejects an inquiry with no message instead of returning a 500', async () => {
    const student = await makeUser();

    const res = await request(app)
      .post('/api/v1/inquiries')
      .set(auth(student.token))
      .send({ subject: 'Only a subject' });

    expect(res.status).toBe(400);
  });

  it('404s when replying to an inquiry that does not exist', async () => {
    const admin = await makeAdmin();

    const res = await request(app)
      .post('/api/v1/inquiries/6a5e7a9e53a5fc83debb6059/reply')
      .set(auth(admin.token))
      .send({ message: 'Hello?' });

    expect(res.status).toBe(404);
  });
});

describe('brute-force protection is actually wired up', () => {
  it('starts rejecting repeated failed logins for the same address', async () => {
    const email = `brute-${Date.now()}@example.com`;

    let sawRateLimit = false;
    for (let i = 0; i < 13; i += 1) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'WrongPassword1' });
      if (res.status === 429) {
        sawRateLimit = true;
        break;
      }
    }

    // The limiter module existed in full but nothing imported it, so every
    // auth route was completely unprotected.
    expect(sawRateLimit).toBe(true);
  });

  it('locks an account after repeated wrong passwords', async () => {
    const victim = await makeUser({ password: 'CorrectHorse1!' });

    for (let i = 0; i < 8; i += 1) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: victim.user.email, password: 'DefinitelyWrong1' });
    }

    // loginAttempts / lockUntil / the isLocked virtual all existed on the User
    // model and nothing ever read or incremented them.
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: victim.user.email, password: 'CorrectHorse1!' });

    expect(res.status).toBe(429);
  });
});
