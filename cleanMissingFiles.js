/**
 * Delete resource records whose bytes are not in the SQLite store.
 *
 * DANGER, and why this script now asks before deleting: it used to look for
 * each record's file at `<repo>/uploads/<file_url>` and hard-delete every
 * record it could not find there. The bytes now live in the SQLite blob store
 * and the `uploads/` tree is gone, so on the current codebase that check misses
 * *everything* — one run would have deleted the entire resource library, the
 * exact loss the blob store was built to prevent.
 *
 * It now asks the store, and reports before it deletes:
 *
 *   node cleanMissingFiles.js            # report only, deletes nothing
 *   node cleanMissingFiles.js --apply    # actually delete the listed records
 *
 * Deleting a record is not the only fix and rarely the first one. A record with
 * no bytes usually means the file was never migrated, so try these first:
 *
 *   npm run migrate:pdfs        # import from an old uploads/ tree
 *   npm run check:pdfs          # what is missing, without touching anything
 *
 * Deletion is permanent and loses the title, course and category. Re-uploading
 * the PDF against the existing record keeps more than deleting and starting
 * over does.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

import connectdb from './src/db/connection.js';
import { Resource } from './src/models/resource.model.js';
import { fileExists } from './src/utils/fileStorage.js';
import { DB_PATH } from './src/db/sqliteStore.js';

const APPLY = process.argv.includes('--apply');

const cleanMissingResources = async () => {
  try {
    await connectdb();
    console.log(`SQLite  : ${DB_PATH}`);

    const resources = await Resource.find({});
    console.log(`Found ${resources.length} total resources in the database.\n`);

    const orphans = resources.filter(
      (r) => !r.file_url || !fileExists(r.file_url),
    );

    for (const r of orphans) {
      console.log(`  ${r.title}`);
      console.log(`      ${r.file_url || '(no file_url)'}`);
    }

    if (!orphans.length) {
      console.log('✅ Every resource record has its bytes in the store.');
      await mongoose.disconnect();
      return;
    }

    // Refuse to wipe the library on a store that is simply empty or pointed at
    // the wrong path — that reads as "every record is broken" and is far more
    // often a misconfigured PDF_DB_PATH than 74 genuinely lost files.
    if (orphans.length === resources.length && resources.length > 1) {
      console.error(
        `\n❌ EVERY record (${resources.length}) is missing its bytes. Refusing to delete.\n` +
          '   That pattern almost always means the store is empty or PDF_DB_PATH\n' +
          `   points somewhere else, not that every file is gone. Check:\n` +
          `     ${DB_PATH}\n` +
          '   and run "npm run migrate:pdfs" if the files were never imported.',
      );
      await mongoose.disconnect();
      process.exit(1);
    }

    if (!APPLY) {
      console.log(
        `\n${orphans.length} record(s) have no bytes in the store and will 404 on download.\n` +
          'Nothing was deleted. Try "npm run migrate:pdfs" or re-upload the file\n' +
          'first — re-run with --apply only if these records should be dropped.',
      );
      await mongoose.disconnect();
      return;
    }

    const ids = orphans.map((r) => r._id);
    const { deletedCount } = await Resource.deleteMany({ _id: { $in: ids } });

    console.log(
      `\nCleanup complete! Deleted ${deletedCount} resource records.`,
    );
    await mongoose.disconnect();
  } catch (error) {
    console.error('Error during cleanup:', error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
};

cleanMissingResources();
