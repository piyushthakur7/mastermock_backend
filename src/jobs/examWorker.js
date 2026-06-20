import { redis } from '../utils/redis.js';
import { TestAttempt } from '../models/testAttempt.model.js';

export const setupExamWorker = async () => {
  if (!redis) {
    console.warn('Redis not configured. Exam Worker not started.');
    return;
  }

  // Prevent starting persistent worker in Serverless environments like Vercel
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_VERSION) {
    console.warn(
      'Running in a serverless environment (Vercel/Lambda). Exam Worker disabled to prevent 503 timeouts.',
    );
    return;
  }

  try {
    const { Worker } = await import('bullmq');

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
  } catch (err) {
    console.error('Failed to start Exam Worker:', err.message);
  }
};
