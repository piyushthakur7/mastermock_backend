import { TestAttempt } from '../models/testAttempt.model.js';
import { Hack } from '../models/hack.model.js';
import { scoreAttempt } from '../services/scoring.service.js';

const SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * Auto-submit expired attempts without any external queue.
 *
 * Every attempt stores a hard deadline in `expires_at` when it starts.
 * This sweeper runs once a minute and completes any IN_PROGRESS attempt
 * whose deadline has passed. Because the deadline lives in the database,
 * expired attempts survive server restarts (unlike an in-process timer)
 * and controllers can also enforce it lazily on access.
 */
export const setupExamWorker = () => {
  // Serverless platforms kill idle processes, so an interval can't be
  // relied on there — controllers still enforce expiry lazily on access.
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_VERSION) {
    console.warn(
      'Serverless environment detected. Auto-submit sweeper disabled; attempt expiry is enforced on access.',
    );
    return;
  }

  const sweep = async () => {
    try {
      const expired = await TestAttempt.find({
        status: 'IN_PROGRESS',
        expires_at: { $lte: new Date() },
      });
      if (!expired.length) return;

      // Attempts must be scored as they complete — the leaderboard reads
      // COMPLETED attempts directly, so a bulk update without scoring would
      // leave everyone auto-submitted stuck at 0. Cache hacks per sweep
      // since many expired attempts usually belong to the same test.
      const hackCache = new Map();
      for (const attempt of expired) {
        attempt.status = 'COMPLETED';
        attempt.completed_at = attempt.expires_at;

        const hackId = attempt.hack.toString();
        if (!hackCache.has(hackId)) {
          hackCache.set(hackId, await Hack.findById(hackId));
        }
        const hack = hackCache.get(hackId);
        if (hack) scoreAttempt(attempt, hack);

        await attempt.save();
      }
      console.log(`Auto-submitted ${expired.length} expired attempt(s)`);
    } catch (err) {
      console.error('Auto-submit sweep failed:', err.message);
    }
  };

  // unref so a pending sweep never keeps the process alive on its own —
  // otherwise the node process (and any test run) refuses to exit.
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  console.log('Exam auto-submit sweeper started');
  return timer;
};
