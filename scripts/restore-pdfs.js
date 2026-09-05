/**
 * Put recovered PDF files back against the resource records that already exist.
 *
 * When the bytes were lost the Mongo records survived, so every resource kept
 * its title, category, price and creation date and only the payload went
 * missing. Re-uploading through the admin UI creates a *new* record and leaves
 * the broken one behind, so the library ends up with duplicates, half of which
 * still 404. This fills in the missing bytes for the record that is already
 * there.
 *
 *   node scripts/restore-pdfs.js --from ~/Downloads           # report only
 *   node scripts/restore-pdfs.js --from ~/Downloads --apply   # import
 *
 * Files are matched to records by name, ignoring case, spaces, underscores and
 * punctuation, against both the resource title and the original upload filename
 * kept inside the storage key. That matters because a PDF saved from the site's
 * own download button is named after the *title* (with "/" replaced), while a
 * copy kept from before the upload is named whatever the admin called it.
 *
 * Safe to re-run: a record that already has its bytes is left alone, and
 * nothing on disk is modified or deleted.
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import connectdb from '../src/db/connection.js';
import { Resource } from '../src/models/resource.model.js';
import { saveFile, fileExists } from '../src/utils/fileStorage.js';
import { DB_PATH } from '../src/db/sqliteStore.js';

const APPLY = process.argv.includes('--apply');

const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
};

const FROM = argValue('--from');

if (!FROM) {
  console.error(
    'Usage: node scripts/restore-pdfs.js --from <directory> [--apply]\n' +
      '\n' +
      '  --from   directory holding the recovered PDFs (searched recursively)\n' +
      '  --apply  actually import them; without it nothing is written',
  );
  process.exit(1);
}

/**
 * Reduce a name to something that survives being renamed by a browser, a chat
 * app or an admin: case, spaces, underscores, dashes and punctuation all go.
 * "Simplification Part-2 (SBI/IBPS PO Prelims 2026)" and
 * "Simplification Part-2 (SBI_IBPS PO Prelims 2026).pdf" collapse to the same
 * key, which is what makes a download saved from the site match its record.
 */
const nameKey = (value) =>
  value
    .toLowerCase()
    .replace(/\.pdf$/, '')
    .replace(/[^a-z0-9]+/g, '');

/** The original upload filename is embedded in the storage key. */
const uploadName = (storageKey) => {
  const base = path.basename(storageKey || '');
  const m = /^[a-z]+_[0-9a-f]{16}_(.+)$/i.exec(base);
  return m ? m[1] : base;
};

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && /\.pdf$/i.test(entry.name) ? [full] : [];
  });

const formatBytes = (n) =>
  n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)}MB`
    : `${(n / 1024).toFixed(0)}KB`;

async function run() {
  const root = path.resolve(FROM);
  if (!fs.existsSync(root)) {
    console.error(`No such directory: ${root}`);
    process.exit(1);
  }

  await connectdb();
  console.log(`SQLite  : ${DB_PATH}`);
  console.log(`Source  : ${root}`);

  const files = walk(root);
  console.log(`\n${files.length} PDF file(s) found on disk.`);

  const resources = await Resource.find({}).sort({ createdAt: 1 });
  const needBytes = resources.filter(
    (r) => r.file_url && !fileExists(r.file_url),
  );
  console.log(
    `${resources.length} resource record(s), ${needBytes.length} missing their bytes.`,
  );

  if (!APPLY) console.log('\nDry run — nothing will be written.');

  // Index the records that need bytes, under both names they could be known by.
  const index = new Map();
  for (const r of needBytes) {
    for (const candidate of [r.title, uploadName(r.file_url)]) {
      const k = nameKey(candidate);
      if (!k) continue;
      if (!index.has(k)) index.set(k, new Set());
      index.get(k).add(r);
    }
  }

  const restored = [];
  const unmatched = [];
  const ambiguous = [];
  const notPdf = [];
  const claimed = new Set();
  let bytesRestored = 0;

  for (const file of files) {
    const matches = index.get(nameKey(path.basename(file)));
    if (!matches || !matches.size) {
      unmatched.push(file);
      continue;
    }
    if (matches.size > 1) {
      ambiguous.push({ file, titles: [...matches].map((r) => r.title) });
      continue;
    }

    const resource = [...matches][0];
    if (claimed.has(String(resource._id))) continue;

    const bytes = fs.readFileSync(file);

    // A file that is not a PDF cannot be what was lost, and importing it would
    // mark the record "recovered" while every download stayed broken.
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      notPdf.push(file);
      continue;
    }

    if (APPLY) {
      saveFile(bytes, resource.file_url, {
        originalName: uploadName(resource.file_url),
        mimeType: 'application/pdf',
      });
    }

    claimed.add(String(resource._id));
    restored.push({ title: resource.title, size: bytes.length, file });
    bytesRestored += bytes.length;
    console.log(
      `  ${APPLY ? 'restored' : 'would restore'}  ${formatBytes(bytes.length).padStart(7)}  ${resource.title}`,
    );
  }

  console.log('\n─────────────────────────────────────────────');
  console.log(
    `${APPLY ? 'Restored' : 'Would restore'} : ${restored.length} file(s), ${formatBytes(bytesRestored)}`,
  );
  console.log(`Still missing    : ${needBytes.length - restored.length}`);
  console.log(`Unmatched files  : ${unmatched.length}`);

  if (notPdf.length) {
    console.log(
      `\n⚠️  ${notPdf.length} matching file(s) are not PDFs and were skipped:`,
    );
    for (const f of notPdf.slice(0, 10)) console.log(`  ${f}`);
  }

  if (ambiguous.length) {
    console.log(
      `\n⚠️  ${ambiguous.length} file(s) matched more than one record. Rename the ` +
        'file to the exact resource title and re-run:',
    );
    for (const a of ambiguous.slice(0, 10)) {
      console.log(`  ${path.basename(a.file)}`);
      for (const t of a.titles) console.log(`      ${t}`);
    }
  }

  const stillMissing = needBytes.filter((r) => !claimed.has(String(r._id)));
  if (stillMissing.length) {
    console.log(
      `\n${stillMissing.length} record(s) still have no bytes. These 404 for ` +
        'students until the file is found or re-uploaded:',
    );
    for (const r of stillMissing.slice(0, 30)) {
      console.log(`  ${r.title}`);
      console.log(`      needs: ${uploadName(r.file_url)}`);
    }
    if (stillMissing.length > 30) {
      console.log(`  ... and ${stillMissing.length - 30} more`);
    }
  }

  if (!APPLY && restored.length) {
    console.log('\nNothing was written. Re-run with --apply to commit.');
  }

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Restore failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
