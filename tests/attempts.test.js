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

describe('GET /api/v1/attempts/:attemptId — answer key on a finished attempt', () => {
  // Two questions: Q1 answered wrongly, Q2 skipped entirely. The review has
  // to show the correct option for both.
  const twoQuestionHack = (createdBy) =>
    makeHack(createdBy, {
      questions: [
        {
          text: 'What is 2 + 2?',
          marks: 2,
          explanation: 'Two plus two is four.',
          options: [
            { text: '3', is_correct: false },
            { text: '4', is_correct: true },
          ],
        },
        {
          text: 'What is the capital of France?',
          marks: 2,
          explanation: 'Paris has been the capital since 987.',
          options: [
            { text: 'Lyon', is_correct: false },
            { text: 'Paris', is_correct: true },
          ],
        },
      ],
    });

  const answerWrongAndSkip = async (student, hack) => {
    const started = await startAttempt(student, hack);
    const attemptId = started.body.data._id;

    const q1 = hack.questions[0];
    const wrong = q1.options.find((o) => !o.is_correct);
    await request(app)
      .put(`/api/v1/attempts/${attemptId}/answer`)
      .set(auth(student.token))
      .send({
        question_id: q1._id.toString(),
        selected_option_id: wrong._id.toString(),
      });
    // Q2 is never answered.

    return attemptId;
  };

  it('hides the key while the attempt is still in progress', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await twoQuestionHack(admin.user._id);

    const attemptId = await answerWrongAndSkip(student, hack);

    const res = await request(app)
      .get(`/api/v1/attempts/${attemptId}`)
      .set(auth(student.token));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('IN_PROGRESS');
    expect(res.body.data.questions).toBeUndefined();
  });

  it('releases the key for every question once completed, including skipped ones', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await twoQuestionHack(admin.user._id);

    const attemptId = await answerWrongAndSkip(student, hack);
    await request(app)
      .post(`/api/v1/attempts/${attemptId}/submit`)
      .set(auth(student.token));

    const res = await request(app)
      .get(`/api/v1/attempts/${attemptId}`)
      .set(auth(student.token));

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('COMPLETED');

    // Every question on the hack, not just the one the student touched.
    expect(res.body.data.questions).toHaveLength(2);
    expect(res.body.data.answers).toHaveLength(1);

    const [q1, q2] = res.body.data.questions;

    expect(q1.text).toBe('What is 2 + 2?');
    expect(q1.marks).toBe(2);
    expect(q1.explanation).toBe('Two plus two is four.');
    expect(q1.options).toHaveLength(2);
    expect(q1.options.map((o) => [o.text, o.is_correct])).toEqual([
      ['3', false],
      ['4', true],
    ]);
    expect(q1.correct_option_text).toBe('4');
    expect(q1.correct_option_id).toBe(q1.options.find((o) => o.is_correct)._id);

    // The skipped question still carries its correct answer.
    expect(q2.text).toBe('What is the capital of France?');
    expect(q2.correct_option_text).toBe('Paris');
    expect(
      res.body.data.answers.some((a) => a.question_id === q2._id.toString()),
    ).toBe(false);

    // ...and the answer the student did give is enriched too.
    const [answer] = res.body.data.answers;
    expect(answer.is_correct).toBe(false);
    expect(answer.selected_option_text).toBe('3');
    expect(answer.correct_option_text).toBe('4');
    expect(answer.correct_option_id).toBe(q1.correct_option_id);
    expect(answer.explanation).toBe('Two plus two is four.');
  });

  it('does not hand another student the attempt (or its key)', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const other = await makeUser();
    const hack = await twoQuestionHack(admin.user._id);

    const attemptId = await answerWrongAndSkip(student, hack);
    await request(app)
      .post(`/api/v1/attempts/${attemptId}/submit`)
      .set(auth(student.token));

    const res = await request(app)
      .get(`/api/v1/attempts/${attemptId}`)
      .set(auth(other.token));

    expect(res.status).toBe(404);
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
