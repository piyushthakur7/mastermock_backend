import request from 'supertest';
import app from '../src/app.js';
import { Hack } from '../src/models/hack.model.js';
import { TestAttempt } from '../src/models/testAttempt.model.js';
import { scoreAttempt } from '../src/services/scoring.service.js';
import { makeUser, makeAdmin, auth } from './helpers.js';

/**
 * A hack with `count` one-mark questions and a configurable wrong-answer
 * penalty. Option 2 of every question is the correct one.
 */
const makeMarkingHack = async (createdBy, { count = 4, penalty = 0.25 } = {}) =>
  Hack.create({
    title: `Marking ${Date.now()}-${Math.random()}`,
    access_type: 'free',
    price: 0,
    total_questions: count,
    passing_marks: 1,
    total_marks: count,
    duration_minutes: 30,
    negative_marking: true,
    negative_marks_per_wrong: penalty,
    created_by: createdBy,
    questions: Array.from({ length: count }, (_, i) => ({
      text: `Question ${i + 1}`,
      marks: 1,
      options: [
        { text: 'wrong', is_correct: false },
        { text: 'right', is_correct: true },
      ],
    })),
  });

/** Answer `hack`'s questions; `pattern` is an array of 'right'|'wrong'|'skip'. */
const attemptWith = async (student, hack, pattern) => {
  const started = await request(app)
    .post('/api/v1/attempts/start')
    .set(auth(student.token))
    .send({ hack_id: hack._id.toString() })
    .expect(201);

  const attemptId = started.body.data._id;

  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i] === 'skip') continue;
    const question = hack.questions[i];
    const option = question.options.find((o) =>
      pattern[i] === 'right' ? o.is_correct : !o.is_correct,
    );
    await request(app)
      .put(`/api/v1/attempts/${attemptId}/answer`)
      .set(auth(student.token))
      .send({
        question_id: question._id.toString(),
        selected_option_id: option._id.toString(),
      })
      .expect(200);
  }

  const submitted = await request(app)
    .post(`/api/v1/attempts/${attemptId}/submit`)
    .set(auth(student.token))
    .expect(200);

  return { attemptId, body: submitted.body };
};

describe('negative totals survive the whole pipeline', () => {
  it('reports -0.25 for one wrong answer, not 0', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await makeMarkingHack(admin.user._id, {
      count: 1,
      penalty: 0.25,
    });

    const { attemptId, body } = await attemptWith(student, hack, ['wrong']);

    // 1. API response carries the true negative value.
    expect(body.data.score).toBe(-0.25);

    // 2. It is the value actually persisted, not something computed on read.
    const stored = await TestAttempt.findById(attemptId);
    expect(stored.score).toBe(-0.25);

    // 3. Every read path agrees.
    const fetched = await request(app)
      .get(`/api/v1/attempts/${attemptId}`)
      .set(auth(student.token))
      .expect(200);
    expect(fetched.body.data.score).toBe(-0.25);

    const list = await request(app)
      .get('/api/v1/attempts/my')
      .set(auth(student.token))
      .expect(200);
    expect(list.body.data.data[0].score).toBe(-0.25);

    // 4. And what the UI renders from it.
    expect(fetched.body.data.score.toFixed(2)).toBe('-0.25');
  });

  it.each([
    [['wrong'], -0.25],
    [['wrong', 'wrong'], -0.5],
    [['wrong', 'wrong', 'wrong', 'wrong', 'wrong'], -1.25],
    [['right', 'wrong'], 0.75],
    [['right', 'right'], 2],
    [['skip', 'skip'], 0],
    [['right', 'wrong', 'wrong', 'wrong', 'wrong'], 0],
  ])('scores %j as %s', async (pattern, expected) => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await makeMarkingHack(admin.user._id, {
      count: pattern.length,
      penalty: 0.25,
    });

    const { body } = await attemptWith(student, hack, pattern);
    expect(body.data.score).toBe(expected);
  });

  it('never penalises an unattempted question', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await makeMarkingHack(admin.user._id, {
      count: 3,
      penalty: 1,
    });

    // Skipping everything must be 0, not -3.
    const { body } = await attemptWith(student, hack, ['skip', 'skip', 'skip']);
    expect(body.data.score).toBe(0);
  });

  it('records a signed per-answer breakdown that sums to the total', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await makeMarkingHack(admin.user._id, {
      count: 3,
      penalty: 0.5,
    });

    const { attemptId } = await attemptWith(student, hack, [
      'right',
      'wrong',
      'wrong',
    ]);

    const stored = await TestAttempt.findById(attemptId);
    const awarded = stored.answers.map((a) => a.marks_awarded);

    expect(awarded).toEqual([1, -0.5, -0.5]);
    expect(awarded.reduce((a, b) => a + b, 0)).toBe(stored.score);
    expect(stored.score).toBe(0);
  });

  it('carries the sign through to percentage', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await makeMarkingHack(admin.user._id, {
      count: 4,
      penalty: 1,
    });

    const { body } = await attemptWith(student, hack, [
      'wrong',
      'wrong',
      'skip',
      'skip',
    ]);

    expect(body.data.score).toBe(-2);
    expect(body.data.percentage).toBe(-50); // -2 out of 4
  });

  it('does not drift into floating point noise', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await makeMarkingHack(admin.user._id, {
      count: 3,
      penalty: 0.1,
    });

    const { body } = await attemptWith(student, hack, [
      'wrong',
      'wrong',
      'wrong',
    ]);

    // 0.1 * 3 in binary floating point is 0.30000000000000004.
    expect(body.data.score).toBe(-0.3);
    expect(String(body.data.score)).not.toMatch(/0000/);
  });
});

describe('penalty sign is normalised', () => {
  it('treats a negative penalty as a magnitude rather than adding marks', () => {
    // An admin typing "-0.25" into a field labelled "negative marks" is
    // natural. Subtracting a negative would have REWARDED wrong answers.
    const hack = {
      negative_marking: true,
      negative_marks_per_wrong: -0.25,
      total_marks: 1,
      questions: [
        {
          _id: '507f1f77bcf86cd799439011',
          marks: 1,
          options: [
            { _id: '507f1f77bcf86cd799439012', is_correct: false },
            { _id: '507f1f77bcf86cd799439013', is_correct: true },
          ],
        },
      ],
    };
    const attempt = {
      answers: [
        {
          question_id: '507f1f77bcf86cd799439011',
          selected_option_id: '507f1f77bcf86cd799439012',
        },
      ],
    };

    scoreAttempt(attempt, hack);
    expect(attempt.score).toBe(-0.25);
  });

  it('accepts a negative value from the admin API instead of rejecting it', async () => {
    const admin = await makeAdmin();

    const res = await request(app)
      .post('/api/v1/hacks')
      .set(auth(admin.token))
      .send({
        title: 'Sign normalisation',
        total_questions: 1,
        passing_marks: 1,
        total_marks: 1,
        duration_minutes: 30,
        negative_marking: true,
        negative_marks_per_wrong: -0.25,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.negative_marks_per_wrong).toBe(0.25);
  });
});

describe('no regression for positive scoring', () => {
  it('still scores a fully correct paper at full marks', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await makeMarkingHack(admin.user._id, {
      count: 4,
      penalty: 0.25,
    });

    const { body } = await attemptWith(student, hack, [
      'right',
      'right',
      'right',
      'right',
    ]);

    expect(body.data.score).toBe(4);
    expect(body.data.percentage).toBe(100);
  });

  it('applies no penalty at all when negative marking is off', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await Hack.create({
      title: `No negative ${Date.now()}`,
      access_type: 'free',
      total_questions: 2,
      passing_marks: 1,
      total_marks: 2,
      duration_minutes: 30,
      negative_marking: false,
      negative_marks_per_wrong: 0.25, // set but must be ignored
      created_by: admin.user._id,
      questions: [1, 2].map((i) => ({
        text: `Q${i}`,
        marks: 1,
        options: [
          { text: 'wrong', is_correct: false },
          { text: 'right', is_correct: true },
        ],
      })),
    });

    const { body } = await attemptWith(student, hack, ['wrong', 'wrong']);
    expect(body.data.score).toBe(0);
  });
});
