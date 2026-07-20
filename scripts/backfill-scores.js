/**
 * One-off backfill: re-score every COMPLETED attempt.
 *
 * Before scoring moved into the completion paths, attempts that were
 * auto-submitted (or where the client never called /evaluate) stayed at the
 * schema default score of 0 and polluted the leaderboard. Scoring is
 * deterministic, so re-running this is always safe.
 *
 * Usage: node scripts/backfill-scores.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { TestAttempt } from '../src/models/testAttempt.model.js';
import { Hack } from '../src/models/hack.model.js';
import { scoreAttempt } from '../src/services/scoring.service.js';

dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to DB');

  const hackCache = new Map();
  let scored = 0;
  let skipped = 0;

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
    if (attempt.isModified()) {
      await attempt.save();
      scored++;
      if (before !== attempt.score) {
        console.log(
          `Attempt ${attempt._id}: score ${before} -> ${attempt.score}`,
        );
      }
    }
  }

  console.log(
    `Done. Updated ${scored} attempt(s), skipped ${skipped} with a deleted hack.`,
  );
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
