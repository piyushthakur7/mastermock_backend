import request from 'supertest';
import app from '../src/app.js';
import { makeUser, makeAdmin, auth } from './helpers.js';
import { Resource } from '../src/models/resource.model.js';

// A minimal but structurally valid PDF
const pdfBytes = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
);

const uploadPdf = (token, { title = 'Sample Notes', bytes = pdfBytes } = {}) =>
  request(app)
    .post('/api/v1/resources')
    .set(auth(token))
    .field('title', title)
    .field('resource_type', 'pdf')
    .attach('file', bytes, 'sample.pdf');

describe('PDF upload and download round trip', () => {
  it('serves back the exact bytes that were uploaded', async () => {
    const { token: adminToken } = await makeAdmin();
    const { token: studentToken } = await makeUser();

    const upload = await uploadPdf(adminToken);
    expect(upload.status).toBe(201);

    const res = await request(app)
      .get(`/api/v1/resources/${upload.body.data._id}/download`)
      .set(auth(studentToken))
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-length']).toBe(String(pdfBytes.length));
    expect(Buffer.compare(res.body, pdfBytes)).toBe(0);
  });

  it('round trips a multi-megabyte PDF without truncation', async () => {
    const { token: adminToken } = await makeAdmin();
    const { token: studentToken } = await makeUser();
    const big = Buffer.concat([pdfBytes, Buffer.alloc(5 * 1024 * 1024, 0x41)]);

    const upload = await uploadPdf(adminToken, { bytes: big });
    expect(upload.status).toBe(201);

    const res = await request(app)
      .get(`/api/v1/resources/${upload.body.data._id}/download`)
      .set(auth(studentToken))
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body, big)).toBe(0);
  });

  it('does not corrupt headers when the title contains quotes or newlines', async () => {
    const { token: adminToken } = await makeAdmin();
    const { token: studentToken } = await makeUser();

    const upload = await uploadPdf(adminToken, {
      title: 'Ch 1: "Algebra"\r\nX-Injected: yes',
    });
    expect(upload.status).toBe(201);

    const res = await request(app)
      .get(`/api/v1/resources/${upload.body.data._id}/download`)
      .set(auth(studentToken));

    expect(res.status).toBe(200);
    expect(res.headers['x-injected']).toBeUndefined();
    expect(res.headers['content-disposition']).not.toContain('\n');
  });

  it('404s when the DB row survives but the stored bytes do not', async () => {
    const { token: adminToken } = await makeAdmin();
    const { token: studentToken } = await makeUser();

    const upload = await uploadPdf(adminToken);
    // Simulate the old failure mode: metadata present, payload gone
    await Resource.findByIdAndUpdate(upload.body.data._id, {
      file_url: 'resources/standalone/pdf_missing_gone.pdf',
    });

    const res = await request(app)
      .get(`/api/v1/resources/${upload.body.data._id}/download`)
      .set(auth(studentToken));

    expect(res.status).toBe(404);
  });

  it('requires authentication to download', async () => {
    const { token: adminToken } = await makeAdmin();
    const upload = await uploadPdf(adminToken);

    const res = await request(app).get(
      `/api/v1/resources/${upload.body.data._id}/download`,
    );

    expect(res.status).toBe(401);
  });
});
