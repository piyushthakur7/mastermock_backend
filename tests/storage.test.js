import request from 'supertest';
import fs from 'fs';
import path from 'path';
import app from '../src/app.js';
import { Resource } from '../src/models/resource.model.js';
import { makeUser, makeAdmin, auth } from './helpers.js';

const uploadPdf = (token, filename = 'notes.pdf', body = {}) => {
  const req = request(app)
    .post('/api/v1/resources')
    .set(auth(token))
    .field('title', body.title || 'Uploaded Notes')
    .field('resource_type', 'pdf');

  if (body.access_type) req.field('access_type', body.access_type);
  if (body.price !== undefined) req.field('price', String(body.price));

  return req.attach('file', Buffer.from('%PDF-1.4 real bytes here'), {
    filename,
    contentType: 'application/pdf',
  });
};

const cleanUp = (storageKey) => {
  if (!storageKey) return;
  const full = path.resolve(process.cwd(), 'uploads', storageKey);
  if (fs.existsSync(full)) fs.unlinkSync(full);
};

describe('an upload really lands on disk before a record is written', () => {
  it('stores the bytes and serves them back', async () => {
    const admin = await makeAdmin();

    const created = await uploadPdf(admin.token).expect(201);
    const key = created.body.data.file_url;

    // The record must never exist unless the file does — a "successful" upload
    // that stored nothing is what produced permanently-404ing resources.
    const full = path.resolve(process.cwd(), 'uploads', key);
    expect(fs.existsSync(full)).toBe(true);
    expect(created.body.data.file_available).toBe(true);
    expect(created.body.data.storage_provider).toBe('local');
    expect(created.body.data.mime_type).toBe('application/pdf');

    const download = await request(app)
      .get(`/api/v1/resources/${created.body.data._id}/download`)
      .set(auth(admin.token));

    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(download.body.toString()).toContain('%PDF-1.4');

    cleanUp(key);
  });

  it('records the real byte size rather than trusting the client', async () => {
    const admin = await makeAdmin();
    const created = await uploadPdf(admin.token).expect(201);

    expect(created.body.data.file_size).toBe(
      Buffer.from('%PDF-1.4 real bytes here').length,
    );

    cleanUp(created.body.data.file_url);
  });
});

describe('a record whose file has vanished', () => {
  it('reports file_available: false in the catalogue instead of looking fine', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();

    const created = await uploadPdf(admin.token).expect(201);
    const key = created.body.data.file_url;

    // Exactly what a redeploy does to local disk: bytes gone, record intact.
    cleanUp(key);

    const list = await request(app)
      .get('/api/v1/resources')
      .set(auth(student.token))
      .expect(200);

    const listed = list.body.data.find((r) => r._id === created.body.data._id);
    expect(listed).toBeDefined();
    expect(listed.file_available).toBe(false);
  });

  it('answers with an actionable message and a FILE_MISSING code', async () => {
    const admin = await makeAdmin();
    const student = await makeUser();

    const created = await uploadPdf(admin.token).expect(201);
    cleanUp(created.body.data.file_url);

    const res = await request(app)
      .get(`/api/v1/resources/${created.body.data._id}/download`)
      .set(auth(student.token));

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('FILE_MISSING');
    // The old response was a bare "File not found", which the frontend
    // relayed verbatim and which told the student nothing.
    expect(res.body.message).toMatch(/no longer available/i);
    expect(res.body.message).not.toBe('File not found');
  });

  it('flags the record so an admin can find what needs re-uploading', async () => {
    const admin = await makeAdmin();
    const created = await uploadPdf(admin.token).expect(201);
    cleanUp(created.body.data.file_url);

    await request(app)
      .get(`/api/v1/resources/${created.body.data._id}/download`)
      .set(auth(admin.token));

    const flagged = await Resource.findById(created.body.data._id);
    expect(flagged.file_missing_since).toBeTruthy();
  });

  it('clears the flag once the file is restored', async () => {
    const admin = await makeAdmin();
    const created = await uploadPdf(admin.token).expect(201);
    const key = created.body.data.file_url;
    const full = path.resolve(process.cwd(), 'uploads', key);
    const contents = fs.readFileSync(full);

    cleanUp(key);
    await request(app)
      .get(`/api/v1/resources/${created.body.data._id}/download`)
      .set(auth(admin.token));
    expect(
      (await Resource.findById(created.body.data._id)).file_missing_since,
    ).toBeTruthy();

    // Re-uploaded under the same key.
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);

    await request(app)
      .get(`/api/v1/resources/${created.body.data._id}/download`)
      .set(auth(admin.token))
      .expect(200);

    expect(
      (await Resource.findById(created.body.data._id)).file_missing_since,
    ).toBeFalsy();

    cleanUp(key);
  });
});

describe('storage status endpoint', () => {
  it('tells an admin the store is not durable and lists what is missing', async () => {
    const admin = await makeAdmin();
    const created = await uploadPdf(admin.token).expect(201);
    cleanUp(created.body.data.file_url);

    const res = await request(app)
      .get('/api/v1/resources/storage-status')
      .set(auth(admin.token))
      .expect(200);

    expect(res.body.data.provider).toBe('local');
    expect(res.body.data.durable).toBe(false);
    expect(res.body.data.warning).toMatch(/redeploy|restart/i);
    expect(res.body.data.missing_files).toBe(1);
    expect(res.body.data.missing[0].title).toBe('Uploaded Notes');
  });

  it('is not reachable by a student', async () => {
    const student = await makeUser();

    const res = await request(app)
      .get('/api/v1/resources/storage-status')
      .set(auth(student.token));

    expect(res.status).toBe(403);
  });
});

describe('upload rejects what it cannot store', () => {
  it('refuses an unsupported file type outright', async () => {
    const admin = await makeAdmin();

    const res = await request(app)
      .post('/api/v1/resources')
      .set(auth(admin.token))
      .field('title', 'Executable')
      .field('resource_type', 'pdf')
      .attach('file', Buffer.from('MZ'), {
        filename: 'virus.exe',
        contentType: 'application/x-msdownload',
      });

    expect(res.status).toBe(400);
    expect(await Resource.countDocuments({ title: 'Executable' })).toBe(0);
  });

  it('refuses a paid resource with no price, storing nothing', async () => {
    const admin = await makeAdmin();

    const res = await uploadPdf(admin.token, 'paid.pdf', {
      title: 'Paid No Price',
      access_type: 'paid',
      price: 0,
    });

    expect(res.status).toBe(400);
    expect(await Resource.countDocuments({ title: 'Paid No Price' })).toBe(0);
  });
});
