import { TestAttempt } from '../models/testAttempt.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { redis } from '../utils/redis.js';

export const getMockTestLeaderboard = asyncHandler(async (req, res) => {
  const { testId } = req.params;

  // Redis logic to cache
  const cacheKey = `leaderboard:${testId}`;
  if (redis) {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json(
        new ApiResponse(
          200,
          JSON.parse(cached),
          'Leaderboard fetched from cache',
        ),
      );
    }
  }

  // Top 10 by score
  const leaderboard = await TestAttempt.find({
    mock_test: testId,
    status: 'COMPLETED',
  })
    .sort({ score: -1, completed_at: 1 })
    .limit(10)
    .populate('user', 'name email');

  if (redis) {
    await redis.set(cacheKey, JSON.stringify(leaderboard), 'EX', 300); // 5 minutes cache
  }

  res.json(new ApiResponse(200, leaderboard, 'Leaderboard fetched'));
});
