import { TestAttempt } from '../models/testAttempt.model.js';
import { Hack } from '../models/hack.model.js';
import { scoreAttempt } from './scoring.service.js';

/**
 * Finalize an attempt exactly once.
 *
 * The claim is atomic: whoever flips IN_PROGRESS -> COMPLETED wins, and every
 * other caller (the auto-submit sweeper, a concurrent submit, a lazy finalize
 * on read) gets null and must not score.
 *
 * The previous shape — find, mutate in memory, save — had no guard, so the
 * sweeper could hold a copy read *before* the student's last answer landed,
 * score those stale answers, and overwrite the correct score with a lower one.
 * Re-reading the document as part of the claim guarantees we score the answers
 * as they actually stand, and once status is COMPLETED saveAnswer can no
 * longer match the attempt, so the answer list is frozen from here.
 */
export const finalizeAttempt = async (attemptId, { completedAt } = {}) => {
  const claimed = await TestAttempt.findOneAndUpdate(
    { _id: attemptId, status: 'IN_PROGRESS' },
    { $set: { status: 'COMPLETED', completed_at: completedAt || new Date() } },
    { new: true },
  );

  if (!claimed) return null;

  const hack = await Hack.findById(claimed.hack);
  if (hack) {
    scoreAttempt(claimed, hack);
    await claimed.save();
  }

  return claimed;
};

/**
 * Enforce the attempt deadline lazily on access. Returns the finalized
 * attempt, or null if it was not expired (or another writer got there first).
 */
export const finalizeIfExpired = async (attempt) => {
  if (!attempt || attempt.status !== 'IN_PROGRESS' || !attempt.expires_at) {
    return null;
  }
  if (attempt.expires_at > new Date()) return null;

  // Completed *as of the deadline*, not as of whenever the request happened to
  // land, so a late read cannot backdate or inflate the recorded finish time.
  return finalizeAttempt(attempt._id, { completedAt: attempt.expires_at });
};
