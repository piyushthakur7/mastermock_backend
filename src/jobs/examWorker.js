import { TestAttempt } from '../models/testAttempt.model.js';

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
      const result = await TestAttempt.updateMany(
        { status: 'IN_PROGRESS', expires_at: { $lte: new Date() } },
        [{ $set: { status: 'COMPLETED', completed_at: '$expires_at' } }],
      );
      if (result.modifiedCount > 0) {
        console.log(`Auto-submitted ${result.modifiedCount} expired attempt(s)`);
      }
    } catch (err) {
      console.error('Auto-submit sweep failed:', err.message);
    }
  };

  setInterval(sweep, SWEEP_INTERVAL_MS);
  console.log('Exam auto-submit sweeper started');
};
