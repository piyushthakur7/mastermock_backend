import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Resolved once at boot. This path must live OUTSIDE the deployed application
// directory — if it sits next to the source, a deploy that overwrites or cleans
// the app folder (git clean -fd, a fresh clone, an unzipped release) takes every
// uploaded PDF with it. That is the failure mode this store exists to end, and
// it comes back the moment the file is parked inside the app tree.
const DB_PATH = path.resolve(env.PDF_DB_PATH);

let db;

try {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
} catch (error) {
  // Thrown at import time, so the process dies before serving traffic. Say why
  // in terms that point at the fix — an unwritable directory (a root-owned
  // /var/lib path, a read-only mount) is the usual cause and the raw EACCES
  // gives no hint that PDF_DB_PATH is the knob to turn.
  console.error(
    `❌ Cannot open the PDF store at ${DB_PATH}\n` +
      `   ${error.message}\n` +
      `   Check PDF_DB_PATH points somewhere the app user can write, e.g.\n` +
      `     sudo mkdir -p ${path.dirname(DB_PATH)} && sudo chown $USER ${path.dirname(DB_PATH)}`,
  );
  throw error;
}

// WAL lets reads (downloads) run concurrently with writes (uploads) instead of
// serialising behind a single global lock.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS resource_files (
    storage_key   TEXT PRIMARY KEY,
    original_name TEXT NOT NULL,
    mime_type     TEXT NOT NULL,
    size          INTEGER NOT NULL,
    data          BLOB NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

logger.info(`PDF store ready at ${DB_PATH}`);

if (DB_PATH.startsWith(path.join(process.cwd(), path.sep))) {
  logger.warn(
    `PDF_DB_PATH (${DB_PATH}) is inside the application directory. A deploy that cleans or overwrites this folder will delete every stored PDF. Move it to a path outside the app tree.`,
  );
}

export { db, DB_PATH };
