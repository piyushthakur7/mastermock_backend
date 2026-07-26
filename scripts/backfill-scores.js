/**
 * Re-score every COMPLETED attempt.
 *
 * Run this after the negative-marking fix: attempts scored by the old code had
 * their totals floored at 0 by `Math.max(0, score)` before being saved, so any
 * candidate who finished below zero is stored as 0 and is indistinguishable
 * from someone who answered nothing. The true value is recoverable because
 * each attempt snapshots the option the student actually selected, so
 * re-running the (now signed) scorer reconstructs it.
 *
 * Scoring is deterministic, so re-running this is always safe.
 *
 *   node scripts/backfill-scores.js            # report only, changes nothing
 *   node scripts/backfill-scores.js --apply    # write the corrected scores
 *
 * NOTE: an attempt whose hack has had its questions edited since will be
 * re-scored against the CURRENT answer key. Those are listed separately.
 */
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { DB_NAME } from '../src/constants.js';
import { TestAttempt } from '../src/models/testAttempt.model.js';
import { Hack } from '../src/models/hack.model.js';
import { scoreAttempt } from '../src/services/scoring.service.js';

const APPLY = process.argv.includes('--apply');

async function run() {
  // dbName must be passed explicitly. This script used to connect to
  // `process.env.MONGO_URI` bare while the app connected to
  // `${MONGO_URI}/${DB_NAME}` — so it silently operated on a different
  // (usually empty) database and appeared to do nothing.
  await mongoose.connect(env.MONGO_URI, { dbName: DB_NAME });
  console.log(
    `Connected to ${mongoose.connection.host}/${mongoose.connection.name}`,
  );
  if (!APPLY) {
    console.log('Dry run — nothing will be written. Re-run with --apply.\n');
  }

  const hackCache = new Map();
  let changed = 0;
  let unchanged = 0;
  let skipped = 0;
  const nowNegative = [];

  const cursor = TestAttempt.find({ status: 'COMPLETED' }).cursor();
  for await (const attempt of cursor) {
    const hackId = attempt.hack.toString();
    if (!hackCache.has(hackId)) {
      hackCache.set(hackId, await Hack.findById(hackId));
    }
    const hack = hackCache.get(hackId);
    if (!hack) {
      skipped++;
      continue;
    }

    const before = attempt.score;
    scoreAttempt(attempt, hack);
    const after = attempt.score;

    if (before !== after) {
      changed++;
      if (after < 0) nowNegative.push({ id: attempt._id, before, after });
      console.log(`Attempt ${attempt._id}: ${before} -> ${after}`);
      if (APPLY) await attempt.save();
    } else {
      unchanged++;
      // Still persist marks_awarded, which did not exist before this fix.
      if (APPLY && attempt.isModified()) await attempt.save();
    }
  }

  console.log(
    `\n${changed} attempt(s) had a different score, ${unchanged} unchanged, ` +
      `${skipped} skipped (hack deleted).`,
  );

  if (nowNegative.length) {
    console.log(
      `\n${nowNegative.length} attempt(s) were stored as a floored value and ` +
        'are genuinely negative. These students will now see their real score ' +
        'and may move down the leaderboard:',
    );
    for (const row of nowNegative.slice(0, 20)) {
      console.log(`  ${row.id}: ${row.before} -> ${row.after}`);
    }
    if (nowNegative.length > 20) {
      console.log(`  ... and ${nowNegative.length - 20} more`);
    }
  }

  if (!APPLY && changed) {
    console.log('\nNothing was written. Re-run with --apply to commit.');
  }

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Backfill failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
