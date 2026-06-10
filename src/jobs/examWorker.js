import { Worker } from 'bullmq';
import { redis } from '../utils/redis.js';
import { TestAttempt } from '../models/testAttempt.model.js';

export const setupExamWorker = () => {
  if (!redis) {
    console.warn('Redis not configured. Exam Worker not started.');
    return;
  }

  const worker = new Worker(
    'exam-autosubmit',
    async (job) => {
      const { attemptId } = job.data;

      const attempt = await TestAttempt.findById(attemptId);

      if (attempt && attempt.status === 'IN_PROGRESS') {
        attempt.status = 'COMPLETED';
        attempt.completed_at = new Date();

        // Evaluation is deferred to the results phase or another job

        await attempt.save();
        console.log(`Auto-submitted attempt ${attemptId}`);
      }
    },
    { connection: redis },
  );

  worker.on('failed', (job, err) => {
    console.error(`Job ${job.id} failed with error ${err.message}`);
  });

  console.log('Exam Auto-Submit Worker started');
};
