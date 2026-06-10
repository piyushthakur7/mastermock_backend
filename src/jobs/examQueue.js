import { Queue } from 'bullmq';
import { redis } from '../utils/redis.js';

export const examQueue = redis
  ? new Queue('exam-autosubmit', { connection: redis })
  : null;

export const scheduleAutoSubmit = async (attemptId, durationMinutes) => {
  if (!examQueue) return;

  // Schedule the job to run after durationMinutes
  const delay = durationMinutes * 60 * 1000;

  await examQueue.add(
    'auto-submit',
    { attemptId },
    {
      delay,
      jobId: `attempt-${attemptId}`, // Ensure only one job per attempt
    },
  );
};
