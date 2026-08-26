/**
 * Verify every resource record still has its bytes in the SQLite store.
 *
 * The failure this exists to catch is silent: the Mongo record and the file
 * lived in different places, so when the files were lost the API kept listing
 * all 74 resources and returning them in the UI, and only a student clicking
 * Download ever saw the 404. Nothing in the logs or on any dashboard said the
 * library had emptied out. That gap is why it went unnoticed for days.
 *
 * Run it on a schedule. It exits non-zero when anything is missing, so cron
 * will email you and any uptime monitor will alarm:
 *
 *   node scripts/check-pdf-integrity.js
 *
 *   # every morning at 07:00, mail on failure
 *   0 7 * * * cd /path/to/app && npm run --silent check:pdfs
 */
import mongoose from 'mongoose';
import connectdb from '../src/db/connection.js';
import { Resource } from '../src/models/resource.model.js';
import { fileExists } from '../src/utils/fileStorage.js';
import { DB_PATH } from '../src/db/sqliteStore.js';

async function run() {
  await connectdb();

  const resources = await Resource.find({
    isDeleted: false,
    is_active: true,
  }).sort({ createdAt: 1 });

  const missing = resources.filter(
    (r) => !r.file_url || !fileExists(r.file_url),
  );

  console.log(
    `Mongo   : ${mongoose.connection.host}/${mongoose.connection.name}`,
  );
  console.log(`SQLite  : ${DB_PATH}`);
  console.log('');
  console.log(`live resource records : ${resources.length}`);
  console.log(`bytes present         : ${resources.length - missing.length}`);
  console.log(`bytes MISSING         : ${missing.length}`);

  await mongoose.disconnect();

  if (missing.length) {
    console.error(
      `\n❌ ${missing.length} resource(s) are listed to students but cannot be ` +
        'downloaded. They will 404:',
    );
    for (const r of missing.slice(0, 30)) {
      console.error(`  ${r.title}`);
      console.error(`      ${r.file_url || '(no file_url)'}`);
    }
    if (missing.length > 30) {
      console.error(`  ... and ${missing.length - 30} more`);
    }
    console.error(
      '\nRestore from a backup (npm run backup:pdfs makes them) or re-upload.',
    );
    process.exit(1);
  }

  console.log('\n✅ Every listed resource has its bytes in the store.');
}

run().catch(async (err) => {
  console.error('Integrity check failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
