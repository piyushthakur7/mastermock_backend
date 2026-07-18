import request from 'supertest';
import app from '../src/app.js';
import { makeAdmin, makeHack, auth, hoursFromNow } from './helpers.js';

describe('GET /api/v1/hacks — schedule window filtering', () => {
  it('lists a test with no schedule', async () => {
    const admin = await makeAdmin();
    await makeHack(admin.user._id, { title: 'Unscheduled' });

    const res = await request(app).get('/api/v1/hacks');

    expect(res.body.data.map((h) => h.title)).toEqual(['Unscheduled']);
    expect(res.body.data[0].schedule_status).toBe('unscheduled');
  });

  it('lists a currently-open test', async () => {
    const admin = await makeAdmin();
    await makeHack(admin.user._id, {
      title: 'Live',
      start_time: hoursFromNow(-1),
      end_time: hoursFromNow(1),
    });

    const res = await request(app).get('/api/v1/hacks');

    expect(res.body.data.map((h) => h.title)).toEqual(['Live']);
    expect(res.body.data[0].schedule_status).toBe('live');
  });

  it('keeps an upcoming test visible so the UI can pre-sell it', async () => {
    const admin = await makeAdmin();
    await makeHack(admin.user._id, {
      title: 'Upcoming',
      start_time: hoursFromNow(2),
      end_time: hoursFromNow(4),
    });

    const res = await request(app).get('/api/v1/hacks');

    expect(res.body.data.map((h) => h.title)).toEqual(['Upcoming']);
    expect(res.body.data[0].schedule_status).toBe('upcoming');
  });

  // This is the production symptom: every surviving test had already closed,
  // so students saw an empty dashboard.
  it('hides a test whose window has closed', async () => {
    const admin = await makeAdmin();
    await makeHack(admin.user._id, {
      title: 'Ended',
      start_time: hoursFromNow(-4),
      end_time: hoursFromNow(-2),
    });

    const res = await request(app).get('/api/v1/hacks');

    expect(res.body.data).toEqual([]);
  });

  it('still shows the closed test to an admin', async () => {
    const admin = await makeAdmin();
    await makeHack(admin.user._id, {
      title: 'Ended',
      start_time: hoursFromNow(-4),
      end_time: hoursFromNow(-2),
    });

    const res = await request(app).get('/api/v1/hacks').set(auth(admin.token));

    expect(res.body.data.map((h) => h.title)).toEqual(['Ended']);
    expect(res.body.data[0].schedule_status).toBe('ended');
  });

  it('hides soft-deleted and unpublished tests from students', async () => {
    const admin = await makeAdmin();
    await makeHack(admin.user._id, { title: 'Deleted', isDeleted: true });
    await makeHack(admin.user._id, { title: 'Unpublished', is_active: false });

    const res = await request(app).get('/api/v1/hacks');

    expect(res.body.data).toEqual([]);
  });
});

describe('GET /api/v1/hacks — field contract', () => {
  it('returns snake_case field names', async () => {
    const admin = await makeAdmin();
    await makeHack(admin.user._id, {
      access_type: 'paid',
      price: 12,
      duration_minutes: 45,
      start_time: hoursFromNow(-1),
      end_time: hoursFromNow(1),
    });

    const [hack] = (await request(app).get('/api/v1/hacks')).body.data;

    // The exact keys the frontend reads.
    expect(hack).toHaveProperty('_id');
    expect(hack).toHaveProperty('title');
    expect(hack).toHaveProperty('access_type', 'paid');
    expect(hack).toHaveProperty('price', 12);
    expect(hack).toHaveProperty('duration_minutes', 45);
    expect(hack).toHaveProperty('start_time');
    expect(hack).toHaveProperty('end_time');

    // camelCase variants must not appear.
    expect(hack.accessType).toBeUndefined();
    expect(hack.durationMinutes).toBeUndefined();
    expect(hack.startTime).toBeUndefined();
    expect(hack.endTime).toBeUndefined();
  });

  it('filters by access_type', async () => {
    const admin = await makeAdmin();
    await makeHack(admin.user._id, { title: 'Free one', access_type: 'free' });
    await makeHack(admin.user._id, {
      title: 'Paid one',
      access_type: 'paid',
      price: 20,
    });

    const res = await request(app).get('/api/v1/hacks?access_type=paid');

    expect(res.body.data.map((h) => h.title)).toEqual(['Paid one']);
  });
});

describe('GET /api/v1/hacks?status= (admin)', () => {
  it('separates PUBLISHED from DRAFT instead of ignoring the filter', async () => {
    const admin = await makeAdmin();
    await makeHack(admin.user._id, { title: 'Published', is_active: true });
    await makeHack(admin.user._id, { title: 'Draft', is_active: false });

    const published = await request(app)
      .get('/api/v1/hacks?status=PUBLISHED')
      .set(auth(admin.token));
    const draft = await request(app)
      .get('/api/v1/hacks?status=DRAFT')
      .set(auth(admin.token));

    expect(published.body.data.map((h) => h.title)).toEqual(['Published']);
    expect(draft.body.data.map((h) => h.title)).toEqual(['Draft']);
  });
});
