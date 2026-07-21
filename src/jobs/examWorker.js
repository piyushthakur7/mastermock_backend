import { TestAttempt } from '../models/testAttempt.model.js';
import { finalizeAttempt } from '../services/attempt.service.js';
import { logger } from '../utils/logger.js';

const SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * Auto-submit expired attempts without any external queue.
 *
 * Every attempt stores a hard deadline in `expires_at` when it starts.
 * This sweeper runs once a minute and completes any IN_PROGRESS attempt
 * whose deadline has passed. Because the deadline lives in the database,
 * expired attempts survive server restarts (unlike an in-process timer)
 * and controllers can also enforce it lazily on access.
 *
 * Finalization goes through finalizeAttempt so the claim is atomic. The old
 * loop loaded each document, mutated it and saved — a copy read just before a
 * student's last answer landed would score without it and overwrite the
 * correct total.
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
      // Only the identifiers are needed: finalizeAttempt re-reads the document
      // as part of its atomic claim, so nothing here can go stale.
      const expired = await TestAttempt.find({
        status: 'IN_PROGRESS',
        expires_at: { $lte: new Date() },
      }).select('_id expires_at');

      if (!expired.length) return;

      let finalized = 0;
      for (const attempt of expired) {
        try {
          const result = await finalizeAttempt(attempt._id, {
            completedAt: attempt.expires_at,
          });
          if (result) finalized += 1;
        } catch (err) {
          logger.error(
            `Auto-submit failed for attempt=${attempt._id}: ${err.message}`,
          );
        }
      }

      if (finalized) {
        logger.info(`Auto-submitted ${finalized} expired attempt(s)`);
      }
    } catch (err) {
      logger.error(`Auto-submit sweep failed: ${err.message}`);
    }
  };

  // unref so a pending sweep never keeps the process alive on its own —
  // otherwise the node process (and any test run) refuses to exit.
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info('Exam auto-submit sweeper started');
  return timer;
};
