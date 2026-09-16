import request from 'supertest';
import app from '../src/app.js';
import { makeUser, makeAdmin, auth } from './helpers.js';
import { Resource } from '../src/models/resource.model.js';
import { fileExists } from '../src/utils/fileStorage.js';

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

describe('download filename', () => {
  it('keeps a non-ASCII title intact via filename*', async () => {
    const { token: adminToken } = await makeAdmin();
    const { token: studentToken } = await makeUser();

    const upload = await uploadPdf(adminToken, {
      title: 'गणित अध्याय 1',
    });
    expect(upload.status).toBe(201);

    const res = await request(app)
      .get(`/api/v1/resources/${upload.body.data._id}/download`)
      .set(auth(studentToken));

    const disposition = res.headers['content-disposition'];
    // The ASCII fallback is still there for old clients...
    expect(disposition).toContain('attachment; filename="');
    // ...but the real title survives in the RFC 5987 parameter.
    expect(disposition).toContain(
      `filename*=UTF-8''${encodeURIComponent('गणित अध्याय 1.pdf')}`,
    );
  });

  it('does not double the extension when the title already ends in .pdf', async () => {
    const { token: adminToken } = await makeAdmin();
    const { token: studentToken } = await makeUser();

    const upload = await uploadPdf(adminToken, { title: 'Answer Key.pdf' });

    const res = await request(app)
      .get(`/api/v1/resources/${upload.body.data._id}/download`)
      .set(auth(studentToken));

    expect(res.headers['content-disposition']).toContain(
      'filename="Answer Key.pdf"',
    );
    expect(res.headers['content-disposition']).not.toContain('.pdf.pdf');
  });
});

describe('upload rejections explain themselves', () => {
  it('400s with a usable message when the file is sent under the wrong field', async () => {
    const { token: adminToken } = await makeAdmin();

    const res = await request(app)
      .post('/api/v1/resources')
      .set(auth(adminToken))
      .field('title', 'Wrong Field')
      .field('resource_type', 'pdf')
      .attach('pdf', pdfBytes, 'sample.pdf');

    // Not a 500: the admin is told which field name to use.
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('"file"');
  });
});

describe('resources whose bytes are gone', () => {
  const loseBytes = (id) =>
    Resource.findByIdAndUpdate(id, {
      file_url: 'resources/standalone/pdf_missing_gone.pdf',
    });

  it('are flagged unavailable in the listing', async () => {
    const { token: adminToken } = await makeAdmin();
    const { token: studentToken } = await makeUser();

    const intact = await uploadPdf(adminToken, { title: 'Intact' });
    const broken = await uploadPdf(adminToken, { title: 'Broken' });
    await loseBytes(broken.body.data._id);

    const res = await request(app)
      .get('/api/v1/resources')
      .set(auth(studentToken));

    const byId = new Map(res.body.data.map((r) => [r._id, r]));
    expect(byId.get(intact.body.data._id).file_available).toBe(true);
    expect(byId.get(broken.body.data._id).file_available).toBe(false);
  });

  it('can have the file put back under the same record', async () => {
    const { token: adminToken } = await makeAdmin();
    const { token: studentToken } = await makeUser();

    const upload = await uploadPdf(adminToken, { title: 'Syllogism Part-1' });
    const id = upload.body.data._id;
    await loseBytes(id);

    const replacement = Buffer.concat([pdfBytes, Buffer.from('restored')]);
    const put = await request(app)
      .put(`/api/v1/resources/${id}/file`)
      .set(auth(adminToken))
      .attach('file', replacement, 'syllogism-1.pdf');

    expect(put.status).toBe(200);
    expect(put.body.data._id).toBe(id);
    expect(put.body.data.title).toBe('Syllogism Part-1');
    expect(put.body.data.file_available).toBe(true);
    expect(await Resource.countDocuments()).toBe(1);

    const res = await request(app)
      .get(`/api/v1/resources/${id}/download`)
      .set(auth(studentToken))
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body, replacement)).toBe(0);
  });

  it('drops the old bytes when a file is replaced', async () => {
    const { token: adminToken } = await makeAdmin();
    const upload = await uploadPdf(adminToken);
    const { _id: id, file_url: oldKey } = upload.body.data;

    const put = await request(app)
      .put(`/api/v1/resources/${id}/file`)
      .set(auth(adminToken))
      .attach('file', pdfBytes, 'new.pdf');

    expect(fileExists(put.body.data.file_url)).toBe(true);
    expect(fileExists(oldKey)).toBe(false);
  });

  it('only lets an admin replace a file', async () => {
    const { token: adminToken } = await makeAdmin();
    const { token: studentToken } = await makeUser();
    const upload = await uploadPdf(adminToken);

    const res = await request(app)
      .put(`/api/v1/resources/${upload.body.data._id}/file`)
      .set(auth(studentToken))
      .attach('file', pdfBytes, 'evil.pdf');

    expect(res.status).toBe(403);
  });

  it('tells the student the download is temporarily unavailable', async () => {
    const { token: adminToken } = await makeAdmin();
    const { token: studentToken } = await makeUser();
    const upload = await uploadPdf(adminToken);
    await loseBytes(upload.body.data._id);

    const res = await request(app)
      .get(`/api/v1/resources/${upload.body.data._id}/download`)
      .set(auth(studentToken));

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/temporarily unavailable/);
  });
});

describe('deleting a resource', () => {
  it('removes the record and the stored bytes together', async () => {
    const { token: adminToken } = await makeAdmin();
    const { token: studentToken } = await makeUser();

    const upload = await uploadPdf(adminToken);
    const { _id: id, file_url: storageKey } = upload.body.data;
    expect(fileExists(storageKey)).toBe(true);

    const del = await request(app)
      .delete(`/api/v1/resources/${id}`)
      .set(auth(adminToken));
    expect(del.status).toBe(200);

    expect(fileExists(storageKey)).toBe(false);
    const res = await request(app)
      .get(`/api/v1/resources/${id}/download`)
      .set(auth(studentToken));
    expect(res.status).toBe(404);
  });
});
