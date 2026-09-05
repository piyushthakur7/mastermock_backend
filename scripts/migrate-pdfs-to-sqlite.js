/**
 * Import PDFs from the old on-disk `uploads/` tree into the SQLite blob store.
 *
 * Resources used to be written to `<process.cwd()>/uploads/<file_url>` and read
 * back from the same path at download time. The Mongo record and the bytes lived
 * in different places, so anything that replaced the app directory (a deploy
 * that cleans untracked files, a fresh clone, an unzipped release) left every
 * record intact and pointing at a file that was no longer there — the listing
 * pages kept working while every download 404'd.
 *
 * This walks each resource record, finds its file on disk, and moves the bytes
 * into SQLite so record and payload travel together from now on.
 *
 *   node scripts/migrate-pdfs-to-sqlite.js                        # report only
 *   node scripts/migrate-pdfs-to-sqlite.js --apply                # import
 *   node scripts/migrate-pdfs-to-sqlite.js --uploads-dir /srv/x   # explicit root
 *
 * Safe to re-run: a resource already present in the store is skipped, and
 * nothing on disk is modified or deleted. Delete the old `uploads/` tree by hand
 * only once a download has been verified in the browser.
 *
 * IMPORTANT: run this with the same working directory and the same .env the app
 * uses, so it connects to the same database and resolves the same relative
 * paths. `process.cwd()` is the cwd of the *process* — if PM2 or systemd starts
 * the app with a different WorkingDirectory, `uploads/` was created there, and
 * you will need --uploads-dir to point at it.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import connectdb from '../src/db/connection.js';
import { Resource } from '../src/models/resource.model.js';
import { saveFile, fileExists } from '../src/utils/fileStorage.js';
import { DB_PATH } from '../src/db/sqliteStore.js';

const APPLY = process.argv.includes('--apply');

const dirFlagIndex = process.argv.indexOf('--uploads-dir');
const EXPLICIT_DIR =
  dirFlagIndex !== -1 ? process.argv[dirFlagIndex + 1] : undefined;

/**
 * Roots to search, most likely first. The old code always resolved against
 * process.cwd(), but the script may well be run from somewhere else.
 */
const candidateRoots = () => {
  if (EXPLICIT_DIR) return [path.resolve(EXPLICIT_DIR)];
  const here = process.cwd();
  return [
    path.join(here, 'uploads'),
    path.join(here, '..', 'uploads'),
    // fileURLToPath, not URL.pathname: on Windows the latter yields "/C:/..."
    // which resolves to a nonexistent path and silently drops this candidate.
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads'),
  ];
};

const formatBytes = (n) =>
  n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)}MB`
    : `${(n / 1024).toFixed(0)}KB`;

async function run() {
  await connectdb();
  console.log(
    `Mongo   : ${mongoose.connection.host}/${mongoose.connection.name}`,
  );
  console.log(`SQLite  : ${DB_PATH}`);

  const roots = candidateRoots();
  const existingRoots = roots.filter((r) => fs.existsSync(r));

  console.log('\nSearched for the old uploads tree in:');
  for (const r of roots) {
    console.log(`  ${fs.existsSync(r) ? '[found]   ' : '[missing] '}${r}`);
  }

  if (!existingRoots.length) {
    console.log(
      '\nNo uploads directory found. Either the files are gone, or they live\n' +
        'somewhere else — find them with:\n' +
        "  find / -name '*Current_Affairs_MCQs*' 2>/dev/null\n" +
        'then re-run with --uploads-dir <the directory containing "resources/">',
    );
    await mongoose.disconnect();
    return;
  }

  if (!APPLY) {
    console.log('\nDry run — nothing will be written. Re-run with --apply.');
  }

  const resources = await Resource.find({}).sort({ createdAt: 1 });
  console.log(`\n${resources.length} resource record(s) in the database.\n`);

  const imported = [];
  const alreadyStored = [];
  const missing = [];
  const notPdf = [];
  let bytesImported = 0;

  for (const resource of resources) {
    const label = `${resource.title}`;

    if (!resource.file_url) {
      missing.push({ label, reason: 'record has no file_url' });
      continue;
    }

    if (fileExists(resource.file_url)) {
      alreadyStored.push(label);
      continue;
    }

    const found = existingRoots
      .map((root) => path.join(root, resource.file_url))
      .find((p) => fs.existsSync(p) && fs.statSync(p).isFile());

    if (!found) {
      missing.push({ label, reason: resource.file_url });
      continue;
    }

    const bytes = fs.readFileSync(found);

    // A truncated or half-written upload is worth knowing about before it is
    // copied into the store and declared recovered.
    if (
      resource.resource_type === 'pdf' &&
      !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))
    ) {
      notPdf.push(label);
    }

    if (APPLY) {
      saveFile(bytes, resource.file_url, {
        originalName: path.basename(resource.file_url),
        mimeType: 'application/pdf',
      });
    }

    imported.push({ label, size: bytes.length });
    bytesImported += bytes.length;
    console.log(
      `  ${APPLY ? 'imported' : 'would import'}  ${formatBytes(bytes.length).padStart(7)}  ${label}`,
    );
  }

  console.log('\n─────────────────────────────────────────────');
  console.log(
    `${APPLY ? 'Imported' : 'Would import'}: ${imported.length} file(s), ${formatBytes(bytesImported)}`,
  );
  console.log(`Already in store : ${alreadyStored.length}`);
  console.log(`Missing on disk  : ${missing.length}`);

  if (notPdf.length) {
    console.log(
      `\n⚠️  ${notPdf.length} file(s) do not start with a PDF header and may be ` +
        'truncated. Open one before trusting it:',
    );
    for (const label of notPdf.slice(0, 10)) console.log(`  ${label}`);
  }

  if (missing.length) {
    console.log(
      `\n${missing.length} record(s) have no file on disk. These will keep ` +
        '404ing and must be re-uploaded:',
    );
    for (const m of missing.slice(0, 30)) {
      console.log(`  ${m.label}`);
      console.log(`      ${m.reason}`);
    }
    if (missing.length > 30) {
      console.log(`  ... and ${missing.length - 30} more`);
    }
  }

  if (!APPLY && imported.length) {
    console.log('\nNothing was written. Re-run with --apply to commit.');
  }

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Migration failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
