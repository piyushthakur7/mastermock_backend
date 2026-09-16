import request from 'supertest';
import app from '../src/app.js';
import { TestAttempt } from '../src/models/testAttempt.model.js';
import { completeAttempt } from '../src/services/attempt.service.js';
import { makeUser, makeAdmin, makeHack, auth } from './helpers.js';

// Ten 1-mark questions, 0.25 off per wrong answer — the shape of the live
// daily mocks. Option 0 is always the correct one.
const tenQuestionMock = (adminId) =>
  makeHack(adminId, {
    negative_marking: true,
    negative_marks_per_wrong: 0.25,
    questions: Array.from({ length: 10 }, (_, i) => ({
      text: `Question ${i + 1}`,
      marks: 1,
      options: [
        { text: 'right', is_correct: true },
        { text: 'wrong', is_correct: false },
      ],
    })),
  });

const start = async (student, hack) => {
  const res = await request(app)
    .post('/api/v1/attempts/start')
    .set(auth(student.token))
    .send({ hack_id: hack._id.toString() });
  return res.body.data._id;
};

const pick = (hack, n, correct) => ({
  question_id: hack.questions[n - 1]._id.toString(),
  selected_option_id:
    hack.questions[n - 1].options[correct ? 0 : 1]._id.toString(),
});

const save = (student, attemptId, answer) =>
  request(app)
    .put(`/api/v1/attempts/${attemptId}/answer`)
    .set(auth(student.token))
    .send(answer);

const submit = (student, attemptId, answers) =>
  request(app)
    .post(`/api/v1/attempts/${attemptId}/submit`)
    .set(auth(student.token))
    .send(answers ? { answers } : {});

describe('answers that never reached the server', () => {
  // Reproduces a real paid attempt: the student answered all ten (7 right,
  // 3 wrong) but the saves for Q4-Q6 were lost, so it was scored 3.25.
  const sheet = (hack) => [
    pick(hack, 1, true),
    pick(hack, 2, true),
    pick(hack, 3, true),
    pick(hack, 4, true),
    pick(hack, 5, true),
    pick(hack, 6, true),
    pick(hack, 7, false),
    pick(hack, 8, false),
    pick(hack, 9, false),
    pick(hack, 10, true),
  ];
  const savedOnly = (hack) => sheet(hack).filter((_, i) => i < 3 || i > 5);

  it('are scored from the answer sheet sent with the submit', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await tenQuestionMock(admin.user._id);
    const attemptId = await start(student, hack);

    for (const answer of savedOnly(hack)) {
      expect((await save(student, attemptId, answer)).status).toBe(200);
    }

    const res = await submit(student, attemptId, sheet(hack));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('COMPLETED');
    expect(res.body.data.score).toBe(6.25);

    const fetched = await request(app)
      .get(`/api/v1/attempts/${attemptId}`)
      .set(auth(student.token));
    expect(fetched.body.data.totalAttempted).toBe(10);
    expect(fetched.body.data.correctAnswers).toBe(7);
    expect(fetched.body.data.wrongAnswers).toBe(3);
  });

  it('still scores only what was saved when no sheet is sent', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await tenQuestionMock(admin.user._id);
    const attemptId = await start(student, hack);

    for (const answer of savedOnly(hack)) {
      await save(student, attemptId, answer);
    }

    const res = await submit(student, attemptId);
    expect(res.status).toBe(200);
    expect(res.body.data.score).toBe(3.25);
  });

  it('lets the sheet change or clear an answer that was saved earlier', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await tenQuestionMock(admin.user._id);
    const attemptId = await start(student, hack);

    await save(student, attemptId, pick(hack, 1, false));
    await save(student, attemptId, pick(hack, 2, true));

    // On screen: Q1 changed to the right answer, Q2 cleared.
    const res = await submit(student, attemptId, [
      pick(hack, 1, true),
      {
        question_id: hack.questions[1]._id.toString(),
        selected_option_id: null,
      },
    ]);

    expect(res.body.data.score).toBe(1);
  });

  it('ignores the sheet once the deadline has passed', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await tenQuestionMock(admin.user._id);
    const attemptId = await start(student, hack);

    await save(student, attemptId, pick(hack, 1, true));
    await TestAttempt.updateOne(
      { _id: attemptId },
      { $set: { expires_at: new Date(Date.now() - 5 * 60 * 1000) } },
    );

    const res = await submit(student, attemptId, sheet(hack));
    expect(res.status).toBe(200);
    expect(res.body.data.score).toBe(1);
  });

  it('does not reject the submit over one malformed entry', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await tenQuestionMock(admin.user._id);
    const attemptId = await start(student, hack);

    const res = await submit(student, attemptId, [
      { question_id: 'not-an-id', selected_option_id: 'nope' },
      pick(hack, 1, true),
      // An option id that belongs to a different question.
      {
        question_id: hack.questions[2]._id.toString(),
        selected_option_id: hack.questions[3].options[0]._id.toString(),
      },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.data.score).toBe(1);
  });
});

describe('the last answer racing the submit', () => {
  it('preserves a save accepted after the completing request loaded its snapshot', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await tenQuestionMock(admin.user._id);
    const attemptId = await start(student, hack);
    const stale = await TestAttempt.findById(attemptId);
    expect((await save(student, attemptId, pick(hack, 1, true))).status).toBe(
      200,
    );
    const completed = await completeAttempt(stale, hack);
    expect(completed.answers).toHaveLength(1);
    expect(completed.score).toBe(1);
  });

  it('refuses a save that arrives after submit instead of altering the result', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await tenQuestionMock(admin.user._id);
    const attemptId = await start(student, hack);

    await save(student, attemptId, pick(hack, 1, true));
    const submitted = await submit(student, attemptId, [
      pick(hack, 1, true),
      pick(hack, 2, false),
    ]);
    expect(submitted.body.data.score).toBe(0.75);

    const late = await save(student, attemptId, pick(hack, 2, false));
    expect(late.status).toBe(404);

    const stored = await TestAttempt.findById(attemptId);
    expect(stored.answers).toHaveLength(2);
    expect(stored.score).toBe(0.75);
  });

  it('returns the finished result when submit is sent twice', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await tenQuestionMock(admin.user._id);
    const attemptId = await start(student, hack);

    const first = await submit(student, attemptId, [pick(hack, 1, true)]);
    const second = await submit(student, attemptId, [
      pick(hack, 1, true),
      pick(hack, 2, true),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data.status).toBe('COMPLETED');
    expect(second.body.data.score).toBe(1);
  });
});

describe('saving answers', () => {
  it('keeps every answer when saves for different questions overlap', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await tenQuestionMock(admin.user._id);
    const attemptId = await start(student, hack);

    const results = await Promise.all(
      hack.questions.map((_, i) =>
        save(student, attemptId, pick(hack, i + 1, true)),
      ),
    );
    results.forEach((r) => expect(r.status).toBe(200));

    const stored = await TestAttempt.findById(attemptId);
    expect(stored.answers).toHaveLength(10);
  });

  it('never stores two rows for one question', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await tenQuestionMock(admin.user._id);
    const attemptId = await start(student, hack);

    await Promise.all([
      save(student, attemptId, pick(hack, 1, true)),
      save(student, attemptId, pick(hack, 1, false)),
      save(student, attemptId, pick(hack, 1, true)),
    ]);

    const stored = await TestAttempt.findById(attemptId);
    expect(stored.answers).toHaveLength(1);
  });

  it('can change an answer after other answers were added', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await tenQuestionMock(admin.user._id);
    const attemptId = await start(student, hack);

    await save(student, attemptId, pick(hack, 1, false));
    await save(student, attemptId, pick(hack, 2, true));
    await save(student, attemptId, pick(hack, 3, true));
    const changed = await save(student, attemptId, pick(hack, 1, true));
    expect(changed.status).toBe(200);

    const res = await submit(student, attemptId);
    expect(res.body.data.score).toBe(3);
  });

  it('does not count a cleared answer as attempted or wrong', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await tenQuestionMock(admin.user._id);
    const attemptId = await start(student, hack);

    await save(student, attemptId, pick(hack, 1, true));
    await save(student, attemptId, pick(hack, 2, false));
    await save(student, attemptId, {
      question_id: hack.questions[1]._id.toString(),
      selected_option_id: null,
    });
    await submit(student, attemptId);

    const res = await request(app)
      .get(`/api/v1/attempts/${attemptId}`)
      .set(auth(student.token));

    expect(res.body.data.score).toBe(1);
    expect(res.body.data.totalAttempted).toBe(1);
    expect(res.body.data.wrongAnswers).toBe(0);
  });
});
