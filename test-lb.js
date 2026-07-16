import mongoose from 'mongoose';
import { TestAttempt } from './src/models/testAttempt.model.js';
import dotenv from 'dotenv';

dotenv.config();

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(
      'Connected to DB. MongoDB version:',
      (await mongoose.connection.db.admin().serverInfo()).version,
    );

    // Let's pick an arbitrary testId to see if the query fails generically
    const testId = new mongoose.Types.ObjectId().toString();
    const limit = 100;
    const skip = 0;

    const leaderboard = await TestAttempt.aggregate([
      {
        $match: {
          hack: new mongoose.Types.ObjectId(testId),
          status: 'COMPLETED',
        },
      },
      {
        $group: {
          _id: '$user',
          best_score: { $max: '$score' },
          best_percentage: { $max: '$percentage' },
          total_attempts: { $sum: 1 },
          last_attempt_at: { $max: '$completed_at' },
        },
      },
      { $sort: { best_score: -1, last_attempt_at: 1 } },
      {
        $setWindowFields: {
          sortBy: { best_score: -1, last_attempt_at: 1 },
          output: {
            rank: { $rank: {} },
          },
        },
      },
      {
        $facet: {
          metadata: [{ $count: 'total_participants' }],
          entries: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ]);

    console.log('Success:', JSON.stringify(leaderboard, null, 2));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    mongoose.disconnect();
  }
}

run();
