import request from 'supertest';
import app from '../src/app.js';
import { Hack } from '../src/models/hack.model.js';
import { TestAttempt } from '../src/models/testAttempt.model.js';
import {
  makeUser,
  makeAdmin,
  makeHack,
  auth,
  hoursFromNow,
} from './helpers.js';

const startAttempt = async (student, hack) =>
  request(app)
    .post('/api/v1/attempts/start')
    .set(auth(student.token))
    .send({ hack_id: hack._id.toString() });

describe('POST /api/v1/attempts/start — accepted id field', () => {
  it('accepts hack_id', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await makeHack(admin.user._id);

    const res = await request(app)
      .post('/api/v1/attempts/start')
      .set(auth(student.token))
      .send({ hack_id: hack._id.toString() });

    expect(res.status).toBe(201);
    expect(res.body.data.hack).toBe(hack._id.toString());
  });

  it('still accepts the legacy mock_test_id', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await makeHack(admin.user._id);

    const res = await request(app)
      .post('/api/v1/attempts/start')
      .set(auth(student.token))
      .send({ mock_test_id: hack._id.toString() });

    expect(res.status).toBe(201);
    expect(res.body.data.hack).toBe(hack._id.toString());
  });

  it('rejects a request with neither', async () => {
    const student = await makeUser();

    const res = await request(app)
      .post('/api/v1/attempts/start')
      .set(auth(student.token))
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('attempt lifecycle', () => {
  it('scores a correct answer and clears the flag when re-evaluated after a change', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await makeHack(admin.user._id);
    const question = hack.questions[0];
    const correct = question.options.find((o) => o.is_correct);
    const wrong = question.options.find((o) => !o.is_correct);

    const started = await startAttempt(student, hack);
    expect(started.status).toBe(201);
    const attemptId = started.body.data._id;

    await request(app)
      .put(`/api/v1/attempts/${attemptId}/answer`)
      .set(auth(student.token))
      .send({
        question_id: question._id.toString(),
        selected_option_id: correct._id.toString(),
      });

    await request(app)
      .post(`/api/v1/attempts/${attemptId}/submit`)
      .set(auth(student.token));

    const first = await request(app)
      .post(`/api/v1/attempts/${attemptId}/evaluate`)
      .set(auth(student.token));

    expect(first.body.data.score).toBe(2);
    expect(first.body.data.answers[0].is_correct).toBe(true);

    // Rewrite the stored answer to the wrong option and re-evaluate: the
    // previous is_correct: true must not survive.
    await TestAttempt.updateOne(
      { _id: attemptId },
      { $set: { 'answers.0.selected_option_id': wrong._id } },
    );

    const second = await request(app)
      .post(`/api/v1/attempts/${attemptId}/evaluate`)
      .set(auth(student.token));

    expect(second.body.data.score).toBe(0);
    expect(second.body.data.answers[0].is_correct).toBe(false);
  });

  it('applies negative marking to a wrong answer', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await makeHack(admin.user._id, {
      negative_marking: true,
      negative_marks_per_wrong: 1,
    });
    const question = hack.questions[0];
    const wrong = question.options.find((o) => !o.is_correct);

    const started = await startAttempt(student, hack);
    const attemptId = started.body.data._id;

    await request(app)
      .put(`/api/v1/attempts/${attemptId}/answer`)
      .set(auth(student.token))
      .send({
        question_id: question._id.toString(),
        selected_option_id: wrong._id.toString(),
      });
    await request(app)
      .post(`/api/v1/attempts/${attemptId}/submit`)
      .set(auth(student.token));

    const res = await request(app)
      .post(`/api/v1/attempts/${attemptId}/evaluate`)
      .set(auth(student.token));

    // Clamped at zero rather than going negative.
    expect(res.body.data.score).toBe(0);
  });
});

describe('attempt flow when the underlying test disappears', () => {
  it('answers with 404, not a 500, when saving an answer', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await makeHack(admin.user._id);
    const questionId = hack.questions[0]._id.toString();

    const started = await startAttempt(student, hack);
    const attemptId = started.body.data._id;

    await Hack.deleteOne({ _id: hack._id });

    const res = await request(app)
      .put(`/api/v1/attempts/${attemptId}/answer`)
      .set(auth(student.token))
      .send({ question_id: questionId, selected_option_id: null });

    expect(res.status).toBe(404);
  });

  it('answers with 404, not a 500, when evaluating', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await makeHack(admin.user._id);

    const started = await startAttempt(student, hack);
    const attemptId = started.body.data._id;
    await request(app)
      .post(`/api/v1/attempts/${attemptId}/submit`)
      .set(auth(student.token));

    await Hack.deleteOne({ _id: hack._id });

    const res = await request(app)
      .post(`/api/v1/attempts/${attemptId}/evaluate`)
      .set(auth(student.token));

    expect(res.status).toBe(404);
  });
});

describe('scheduled window is enforced on start', () => {
  it('refuses a test that has not opened yet', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await makeHack(admin.user._id, {
      start_time: hoursFromNow(2),
      end_time: hoursFromNow(4),
    });

    const res = await startAttempt(student, hack);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/not started yet/i);
  });

  it('refuses a test whose window has closed', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await makeHack(admin.user._id, {
      start_time: hoursFromNow(-4),
      end_time: hoursFromNow(-2),
    });

    const res = await startAttempt(student, hack);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/ended/i);
  });

  it('clamps the attempt deadline to the window close', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    // 90-minute test, but only 30 minutes of window left.
    const hack = await makeHack(admin.user._id, {
      duration_minutes: 90,
      end_time: new Date(Date.now() + 30 * 60 * 1000),
    });

    const res = await startAttempt(student, hack);

    const expiresAt = new Date(res.body.data.expires_at).getTime();
    expect(expiresAt).toBeLessThanOrEqual(
      new Date(hack.end_time).getTime() + 60 * 1000,
    );
  });
});

describe('paid tests require a purchase', () => {
  it('refuses to start without one', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await makeHack(admin.user._id, {
      access_type: 'paid',
      price: 99,
    });

    const res = await startAttempt(student, hack);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/purchase/i);
  });
});
