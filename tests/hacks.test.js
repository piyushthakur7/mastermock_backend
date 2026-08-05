import request from 'supertest';
import app from '../src/app.js';
import {
  makeAdmin,
  makeUser,
  makeHack,
  auth,
  hoursFromNow,
} from './helpers.js';

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

describe('participation counts (admin only)', () => {
  const startAndSubmit = async (student, hack) => {
    const started = await request(app)
      .post('/api/v1/attempts/start')
      .set(auth(student.token))
      .send({ hack_id: hack._id.toString() });
    await request(app)
      .post(`/api/v1/attempts/${started.body.data._id}/submit`)
      .set(auth(student.token));
  };

  it('counts distinct students, not just attempts', async () => {
    const admin = await makeAdmin();
    const alice = await makeUser();
    const bob = await makeUser();
    const hack = await makeHack(admin.user._id);

    // Alice takes it twice (free tests can be retaken), Bob once.
    await startAndSubmit(alice, hack);
    await startAndSubmit(alice, hack);
    await startAndSubmit(bob, hack);

    const list = await request(app).get('/api/v1/hacks').set(auth(admin.token));
    const listed = list.body.data.find((h) => h._id === hack._id.toString());

    expect(listed.unique_students).toBe(2);
    expect(listed.total_attempts).toBe(3);
    expect(listed.completed_attempts).toBe(3);
    expect(listed.students_appeared).toBe(2);

    // Same numbers when opening the single test.
    const one = await request(app)
      .get(`/api/v1/hacks/${hack._id}`)
      .set(auth(admin.token));

    expect(one.body.data.unique_students).toBe(2);
    expect(one.body.data.total_attempts).toBe(3);
    expect(one.body.data.students_appeared).toBe(2);
  });

  it('reports zero for a test nobody has taken', async () => {
    const admin = await makeAdmin();
    const hack = await makeHack(admin.user._id);

    const res = await request(app)
      .get(`/api/v1/hacks/${hack._id}`)
      .set(auth(admin.token));

    expect(res.body.data.unique_students).toBe(0);
    expect(res.body.data.total_attempts).toBe(0);
  });

  it('shows students the participation count but not the admin internals', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const other = await makeUser();
    const hack = await makeHack(admin.user._id);
    await startAndSubmit(student, hack);
    await startAndSubmit(other, hack);

    const list = await request(app)
      .get('/api/v1/hacks')
      .set(auth(student.token));
    const listed = list.body.data.find((h) => h._id === hack._id.toString());

    // Public: the "N students have given this mock" line on the card.
    expect(listed.students_appeared).toBe(2);

    // Operational detail stays admin-only.
    expect(listed.unique_students).toBeUndefined();
    expect(listed.total_attempts).toBeUndefined();
    expect(listed.completed_attempts).toBeUndefined();
  });

  it('counts only students who finished — an abandoned attempt does not count', async () => {
    const admin = await makeAdmin();
    const finisher = await makeUser();
    const quitter = await makeUser();
    const hack = await makeHack(admin.user._id);

    await startAndSubmit(finisher, hack);
    // Starts but never submits: still IN_PROGRESS.
    await request(app)
      .post('/api/v1/attempts/start')
      .set(auth(quitter.token))
      .send({ hack_id: hack._id.toString() });

    const res = await request(app)
      .get(`/api/v1/hacks/${hack._id}`)
      .set(auth(finisher.token));

    expect(res.body.data.students_appeared).toBe(1);
    expect(res.body.data.unique_students).toBeUndefined();
  });

  it('does not double-count a student who retakes a free mock', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    const hack = await makeHack(admin.user._id);

    await startAndSubmit(student, hack);
    await startAndSubmit(student, hack);
    await startAndSubmit(student, hack);

    const res = await request(app)
      .get(`/api/v1/hacks/${hack._id}`)
      .set(auth(student.token));

    expect(res.body.data.students_appeared).toBe(1);
  });
});

describe('PUT /api/v1/hacks/:id — converting a paid test to free', () => {
  it('clears the schedule window so the test becomes startable again', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();
    // A paid test whose scheduled window has already closed.
    const hack = await makeHack(admin.user._id, {
      access_type: 'paid',
      price: 199,
      start_time: hoursFromNow(-5),
      end_time: hoursFromNow(-2),
    });

    // Convert to free AND clear the window, exactly as the admin UI now does.
    const updated = await request(app)
      .put(`/api/v1/hacks/${hack._id}`)
      .set(auth(admin.token))
      .send({
        access_type: 'free',
        price: 0,
        start_time: null,
        end_time: null,
      });

    expect(updated.status).toBe(200);
    expect(updated.body.data.access_type).toBe('free');
    expect(updated.body.data.price).toBe(0);
    expect(updated.body.data.start_time).toBeNull();
    expect(updated.body.data.end_time).toBeNull();

    // It is now visible to students and can actually be started — before the
    // fix the stale expired window kept 403-ing "the window has ended".
    const listed = (await request(app).get('/api/v1/hacks')).body.data;
    expect(listed.map((h) => h._id)).toContain(hack._id.toString());

    const started = await request(app)
      .post('/api/v1/attempts/start')
      .set(auth(student.token))
      .send({ hack_id: hack._id.toString() });

    expect(started.status).toBe(201);
  });
});
