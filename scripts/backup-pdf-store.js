/**
 * Take a consistent backup of the SQLite PDF store.
 *
 * Storing the bytes outside the app directory stops a deploy from eating them,
 * but it is not a backup — a bad `rm`, a disk failure or a botched server
 * migration still loses everything, and the last incident showed the loss can
 * go unnoticed for days. This is the copy you restore from.
 *
 * Uses SQLite's online backup API rather than copying the file. A plain `cp` of
 * a database in WAL mode can capture a torn page or miss commits still sitting
 * in the -wal sidecar; the backup API takes a proper point-in-time snapshot
 * while the app keeps serving.
 *
 *   node scripts/backup-pdf-store.js                  # default dir, keep 14
 *   node scripts/backup-pdf-store.js --dir /mnt/bak   # somewhere else
 *   node scripts/backup-pdf-store.js --keep 30        # deeper history
 *
 *   # nightly at 02:30
 *   30 2 * * * cd /path/to/app && npm run --silent backup:pdfs
 *
 * Keep at least one copy on a different machine — a backup sitting on the same
 * disk as the original does not survive losing that disk. Copy the newest file
 * off-box (rsync, scp, object storage) once this has run.
 */
import fs from 'fs';
import path from 'path';
import { db, DB_PATH } from '../src/db/sqliteStore.js';

const argValue = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const BACKUP_DIR = path.resolve(
  argValue('--dir', path.join(path.dirname(DB_PATH), 'backups')),
);
const KEEP = Number(argValue('--keep', '14'));

const formatBytes = (n) =>
  n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)}MB`
    : `${(n / 1024).toFixed(0)}KB`;

async function run() {
  const rows = db
    .prepare(
      'SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS bytes FROM resource_files',
    )
    .get();

  if (rows.n === 0) {
    // Backing up an empty store over a good history is how a recoverable
    // incident becomes an unrecoverable one.
    console.error(
      '❌ The store is EMPTY (0 files). Refusing to write a backup.\n' +
        '   If this is unexpected, do not run this again until you know why —\n' +
        '   rotation could otherwise overwrite your good backups with empty ones.',
    );
    process.exit(1);
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(BACKUP_DIR, `pdf-store-${stamp}.db`);

  console.log(`source : ${DB_PATH}`);
  console.log(`files  : ${rows.n} (${formatBytes(rows.bytes)})`);
  console.log(`dest   : ${dest}`);

  await db.backup(dest);

  const written = fs.statSync(dest).size;
  console.log(`\n✅ Backup written, ${formatBytes(written)}.`);

  // Rotate oldest-first, keeping the most recent KEEP snapshots.
  const existing = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => /^pdf-store-.*\.db$/.test(f))
    .sort()
    .reverse();

  const stale = existing.slice(KEEP);
  for (const f of stale) {
    fs.unlinkSync(path.join(BACKUP_DIR, f));
    console.log(`   pruned old backup ${f}`);
  }
  console.log(`   ${Math.min(existing.length, KEEP)} backup(s) retained.`);
  console.log(
    '\nRemember: copy the newest file OFF this server. A backup on the same\n' +
      'disk as the original does not survive losing that disk.',
  );
}

run().catch((err) => {
  console.error('Backup failed:', err);
  process.exit(1);
});
