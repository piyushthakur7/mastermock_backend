import { TestAttempt } from '../models/testAttempt.model.js';
import { scoreAttempt } from './scoring.service.js';

/**
 * Finish an attempt: IN_PROGRESS -> COMPLETED with its score, in one
 * conditional write.
 *
 * Three paths can complete the same attempt — the student's submit, the
 * lazy expiry check on access, and the auto-submit sweeper — and they used to
 * load, score and save() independently. Whichever saved last won, so a
 * sweeper holding a stale copy could overwrite a score the submit had just
 * computed from fresher answers. Guarding the write on status means exactly
 * one of them completes the attempt and the others leave it alone.
 *
 * Mutates the in-memory attempt (status, completed_at, per-answer flags,
 * score) either way, so callers can respond from it.
 *
 * @returns the completed document, or null if another request completed it
 *          first.
 */
export const completeAttempt = async (
  attempt,
  hack,
  completedAt = new Date(),
  prepareAnswers,
) => {
  // Answer saves increment __v. Retry against the newest document if a
  // save lands while scoring, so completion never erases an accepted save.
  for (;;) {
    const revision = attempt.__v;
    if (prepareAnswers) prepareAnswers(attempt);
    attempt.status = 'COMPLETED';
    attempt.completed_at = completedAt;
    // A hack deleted mid-attempt still completes; the score just stays 0.
    if (hack) scoreAttempt(attempt, hack);

    const completed = await TestAttempt.findOneAndUpdate(
      { _id: attempt._id, status: 'IN_PROGRESS', __v: revision },
      {
        $set: {
          status: 'COMPLETED',
          completed_at: completedAt,
          answers: attempt.answers.map((a) =>
            typeof a.toObject === 'function' ? a.toObject() : a,
          ),
          score: attempt.score,
          percentage: attempt.percentage,
        },
      },
      { new: true },
    );
    if (completed) return completed;
    const current = await TestAttempt.findById(attempt._id);
    if (!current) return null;
    for (const field of [
      'answers',
      'status',
      'completed_at',
      'score',
      'percentage',
      'updatedAt',
      '__v',
    ]) {
      attempt.set(field, current.get(field));
    }
    if (current.status !== 'IN_PROGRESS') return null;
  }
};
