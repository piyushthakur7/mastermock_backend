import { execFile } from 'child_process';
import { promisify } from 'util';
import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../src/app.js';
import { TestAttempt } from '../src/models/testAttempt.model.js';
import { makeUser, makeAdmin, makeHack, auth } from './helpers.js';

const execFileAsync = promisify(execFile);

describe('leaderboard privacy', () => {
  it("does not publish participants' email addresses", async () => {
    const admin = await makeAdmin();
    const alice = await makeUser({ email: 'alice-private@example.com' });
    const viewer = await makeUser();
    const hack = await makeHack(admin.user._id);

    await TestAttempt.create({
      user: alice.user._id,
      hack: hack._id,
      status: 'COMPLETED',
      score: 2,
      percentage: 100,
      completed_at: new Date(),
      answers: [],
    });

    const res = await request(app)
      .get(`/api/v1/leaderboard/${hack._id}`)
      .set(auth(viewer.token));

    expect(res.status).toBe(200);
    expect(res.body.data.entries).toHaveLength(1);
    expect(res.body.data.entries[0].user.full_name).toBeDefined();
    expect(res.body.data.entries[0].user.email).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('alice-private@example.com');
  });

  // The answer key is released on a COMPLETED attempt, and free tests allow
  // unlimited retakes. Ranking on best-of-N turned that into a free win:
  // submit blank, read the key off the results page, retake, top the board.
  it('ranks a retake on the first attempt, so throwing one away gains nothing', async () => {
    const admin = await makeAdmin();
    const cheater = await makeUser({ full_name: 'Blank First' });
    const honest = await makeUser({ full_name: 'Honest Taker' });
    const viewer = await makeUser();
    const hack = await makeHack(admin.user._id);

    // Cheater: blank attempt, then a perfect retake after reading the key.
    await TestAttempt.create({
      user: cheater.user._id,
      hack: hack._id,
      status: 'COMPLETED',
      score: 0,
      percentage: 0,
      completed_at: new Date(Date.now() - 60 * 60 * 1000),
      answers: [],
    });
    await TestAttempt.create({
      user: cheater.user._id,
      hack: hack._id,
      status: 'COMPLETED',
      score: 2,
      percentage: 100,
      completed_at: new Date(),
      answers: [],
    });

    // Honest student: one attempt, partial credit.
    await TestAttempt.create({
      user: honest.user._id,
      hack: hack._id,
      status: 'COMPLETED',
      score: 1,
      percentage: 50,
      completed_at: new Date(Date.now() - 30 * 60 * 1000),
      answers: [],
    });

    const res = await request(app)
      .get(`/api/v1/leaderboard/${hack._id}`)
      .set(auth(viewer.token));

    expect(res.status).toBe(200);

    const [first, second] = res.body.data.entries;
    expect(first.user.full_name).toBe('Honest Taker');
    expect(first.best_score).toBe(1);
    expect(first.rank).toBe(1);

    // The perfect retake does not count; the blank first attempt does.
    expect(second.user.full_name).toBe('Blank First');
    expect(second.best_score).toBe(0);
    expect(second.rank).toBe(2);
    // The retake is still recorded, just not ranked.
    expect(second.total_attempts).toBe(2);

    // my-rank must agree with the board, or the student sees two answers.
    const mine = await request(app)
      .get(`/api/v1/leaderboard/${hack._id}/my-rank`)
      .set(auth(cheater.token));

    expect(mine.status).toBe(200);
    expect(mine.body.data.rank).toBe(2);
    expect(mine.body.data.best_score).toBe(0);
  });

  it('rejects a malformed test id with 400 rather than crashing', async () => {
    const viewer = await makeUser();

    const res = await request(app)
      .get('/api/v1/leaderboard/not-an-object-id/my-rank')
      .set(auth(viewer.token));

    expect(res.status).toBe(400);
  });
});

describe('error logging', () => {
  it('does not write submitted passwords into the log payload', async () => {
    const { logger } = await import('../src/utils/logger.js');
    const spy = jest.spyOn(logger, 'error').mockImplementation(() => {});

    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'SuperSecret123!' });

    expect(spy).toHaveBeenCalled();
    const logged = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toContain('SuperSecret123!');
    expect(logged).toContain('[REDACTED]');

    spy.mockRestore();
  });
});

describe('environment guard', () => {
  it('refuses to boot in production with the default token secret', async () => {
    const child = execFileAsync(
      process.execPath,
      ['-e', "import('./src/config/env.js')"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'production',
          ACCESS_TOKEN_SECRET: '',
          REFRESH_TOKEN_SECRET: '',
        },
      },
    );

    await expect(child).rejects.toMatchObject({ code: 1 });
  });

  it('boots in production when real secrets are supplied', async () => {
    await execFileAsync(
      process.execPath,
      ['-e', "import('./src/config/env.js')"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'production',
          ACCESS_TOKEN_SECRET: 'a-genuinely-random-production-secret',
          REFRESH_TOKEN_SECRET: 'another-genuinely-random-secret',
        },
      },
    );
  });
});
