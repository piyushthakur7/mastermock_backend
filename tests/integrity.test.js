import request from 'supertest';
import app from '../src/app.js';
import { Hack } from '../src/models/hack.model.js';
import { TestAttempt } from '../src/models/testAttempt.model.js';
import { Notification } from '../src/models/notification.model.js';
import { makeUser, makeAdmin, makeHack, auth } from './helpers.js';

describe('hack totals are derived, not declared', () => {
  it('computes total_marks and total_questions from the questions themselves', async () => {
    const admin = await makeAdmin();

    // The admin claims 100 marks across 10 questions; the actual paper is one
    // 2-mark question. Scoring divides by total_marks, so trusting the claim
    // reported a perfect run as 2%.
    const hack = await makeHack(admin.user._id);
    await Hack.updateOne(
      { _id: hack._id },
      { $set: { total_marks: 100, total_questions: 10 } },
    );

    const reloaded = await Hack.findById(hack._id);
    reloaded.markModified('questions');
    await reloaded.save();

    expect(reloaded.total_marks).toBe(2);
    expect(reloaded.total_questions).toBe(1);
  });

  it('updates the totals when questions are added', async () => {
    const admin = await makeAdmin();
    const hack = await makeHack(admin.user._id);

    await request(app)
      .post(`/api/v1/hacks/${hack._id}/questions`)
      .set(auth(admin.token))
      .send({
        text: 'What is 3 + 3?',
        marks: 5,
        options: [
          { text: '6', is_correct: true },
          { text: '7', is_correct: false },
        ],
      })
      .expect(201);

    const updated = await Hack.findById(hack._id);
    expect(updated.total_questions).toBe(2);
    expect(updated.total_marks).toBe(7); // 2 + 5
  });
});

describe('editing a question does not destroy completed attempts', () => {
  it("keeps a student's score after the admin fixes a typo in an option", async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await makeHack(admin.user._id, {
      negative_marking: true,
      negative_marks_per_wrong: 1,
    });
    const question = hack.questions[0];
    const correct = question.options.find((o) => o.is_correct);

    const started = await request(app)
      .post('/api/v1/attempts/start')
      .set(auth(student.token))
      .send({ hack_id: hack._id.toString() });
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
      .set(auth(student.token))
      .expect(200);

    const before = await TestAttempt.findById(attemptId);
    expect(before.score).toBe(2);

    // The admin corrects a typo. Replacing the options array wholesale used to
    // mint fresh ObjectIds for every option, so the student's stored
    // selected_option_id stopped resolving and the next re-score wiped their
    // result — and with negative marking on, actively deducted marks.
    await request(app)
      .put(`/api/v1/hacks/${hack._id}/questions/${question._id}`)
      .set(auth(admin.token))
      .send({
        text: 'What is 2 + 2? (corrected)',
        marks: 2,
        options: [
          {
            _id: question.options[0]._id.toString(),
            text: '3',
            is_correct: false,
          },
          { _id: correct._id.toString(), text: 'four', is_correct: true },
        ],
      })
      .expect(200);

    const edited = await Hack.findById(hack._id);
    const editedOptionIds = edited.questions[0].options.map((o) =>
      o._id.toString(),
    );
    expect(editedOptionIds).toContain(correct._id.toString());

    const res = await request(app)
      .post(`/api/v1/attempts/${attemptId}/evaluate`)
      .set(auth(student.token))
      .expect(200);

    expect(res.body.data.score).toBe(2);
    expect(res.body.data.answers[0].is_correct).toBe(true);
  });

  it('does not punish an answer whose option no longer exists at all', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await makeHack(admin.user._id, {
      negative_marking: true,
      negative_marks_per_wrong: 5,
    });
    const question = hack.questions[0];
    const correct = question.options.find((o) => o.is_correct);

    const started = await request(app)
      .post('/api/v1/attempts/start')
      .set(auth(student.token))
      .send({ hack_id: hack._id.toString() });
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

    // Force the answer key out from under the attempt.
    await Hack.updateOne(
      { _id: hack._id, 'questions._id': question._id },
      {
        $set: {
          'questions.$.options': [
            { text: 'entirely', is_correct: false },
            { text: 'different', is_correct: true },
          ],
        },
      },
    );

    const res = await request(app)
      .post(`/api/v1/attempts/${attemptId}/evaluate`)
      .set(auth(student.token))
      .expect(200);

    // Scored as unattempted (0), not as wrong (-5).
    expect(res.body.data.answers[0].marks_awarded).toBe(0);
    expect(res.body.data.score).toBe(0);
  });
});

describe('question validation', () => {
  it('rejects a question where no option is marked correct', async () => {
    const admin = await makeAdmin();
    const hack = await makeHack(admin.user._id);

    const res = await request(app)
      .post(`/api/v1/hacks/${hack._id}/questions`)
      .set(auth(admin.token))
      .send({
        text: 'Unanswerable',
        marks: 1,
        options: [
          { text: 'a', is_correct: false },
          { text: 'b', is_correct: false },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/correct/i);
  });

  it('refuses to publish a test whose passing marks exceed the total available', async () => {
    const admin = await makeAdmin();
    const hack = await makeHack(admin.user._id);
    await Hack.updateOne({ _id: hack._id }, { $set: { passing_marks: 999 } });

    const res = await request(app)
      .patch(`/api/v1/hacks/${hack._id}/publish`)
      .set(auth(admin.token));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/passing marks/i);
  });
});

describe('notifications are actually readable', () => {
  it('returns the notifications belonging to the caller', async () => {
    const student = await makeUser();
    const other = await makeUser();

    await Notification.create({
      user: student.user._id,
      title: 'Yours',
      message: 'For you',
    });
    await Notification.create({
      user: other.user._id,
      title: 'Theirs',
      message: 'Not for you',
    });

    // The routes queried a `recipient` field that does not exist on the model,
    // so this list came back empty for every user, forever.
    const res = await request(app)
      .get('/api/v1/notifications')
      .set(auth(student.token))
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Yours');
  });

  it('404s when marking a notification that belongs to someone else', async () => {
    const student = await makeUser();
    const other = await makeUser();
    const notification = await Notification.create({
      user: other.user._id,
      title: 'Theirs',
      message: 'Not for you',
    });

    const res = await request(app)
      .patch(`/api/v1/notifications/${notification._id}/read`)
      .set(auth(student.token));

    expect(res.status).toBe(404);
  });
});

describe('registration with a blank phone number', () => {
  it('lets two people register without a phone number', async () => {
    const first = await request(app).post('/api/v1/auth/register').send({
      full_name: 'First Person',
      email: 'first-blank@example.com',
      password: 'CorrectHorse1',
      phone_number: '',
    });
    expect(first.status).toBe(201);

    // A sparse unique index skips missing values but still indexes '', so the
    // second blank submission used to collide and fail with a 500.
    const second = await request(app).post('/api/v1/auth/register').send({
      full_name: 'Second Person',
      email: 'second-blank@example.com',
      password: 'CorrectHorse1',
      phone_number: '',
    });
    expect(second.status).toBe(201);
  });
});

describe('duplicate key errors do not leak database internals', () => {
  it('reports a taken phone number as a 409 without driver detail', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({
        full_name: 'Phone Owner',
        email: 'owner-phone@example.com',
        password: 'CorrectHorse1',
        phone_number: '9876543210',
      })
      .expect(201);

    const claimant = await makeUser();

    const res = await request(app)
      .patch('/api/v1/users/update-account')
      .set(auth(claimant.token))
      .send({ phone_number: '9876543210' });

    expect(res.status).toBe(409);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('E11000');
    expect(body).not.toContain('index:');
    expect(body).not.toContain('users');
  });
});
