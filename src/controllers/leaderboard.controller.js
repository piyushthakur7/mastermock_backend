import { TestAttempt } from '../models/testAttempt.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { redis } from '../utils/redis.js';
import mongoose from 'mongoose';

// @desc    Get leaderboard for a mock test (best score per user)
// @route   GET /api/v1/leaderboard/:testId?limit=100&page=1
// @access  Private/Student
export const getMockTestLeaderboard = asyncHandler(async (req, res) => {
  const { testId } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const page = parseInt(req.query.page) || 1;
  const skip = (page - 1) * limit;

  // Redis logic to cache
  const cacheKey = `leaderboard:${testId}:${page}:${limit}`;
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

  // Aggregate: group by user, take best score per user, then rank
  const leaderboard = await TestAttempt.aggregate([
    {
      $match: {
        mock_test: new mongoose.Types.ObjectId(testId),
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

  const totalParticipants =
    leaderboard[0]?.metadata[0]?.total_participants || 0;
  let entries = leaderboard[0]?.entries || [];

  // Populate user info
  await TestAttempt.populate(entries, {
    path: '_id',
    model: 'User',
    select: 'full_name email profile_picture',
  });

  // Reshape the entries for cleaner output
  entries = entries.map((entry) => ({
    rank: entry.rank,
    user: entry._id,
    best_score: entry.best_score,
    best_percentage: entry.best_percentage,
    total_attempts: entry.total_attempts,
    last_attempt_at: entry.last_attempt_at,
  }));

  const result = {
    entries,
    total_participants: totalParticipants,
    page,
    limit,
    total_pages: Math.ceil(totalParticipants / limit),
  };

  if (redis) {
    await redis.set(cacheKey, JSON.stringify(result), 'EX', 300); // 5 minutes cache
  }

  res.json(new ApiResponse(200, result, 'Leaderboard fetched'));
});

// @desc    Get the requesting user's rank for a specific test
// @route   GET /api/v1/leaderboard/:testId/my-rank
// @access  Private/Student
export const getMyRank = asyncHandler(async (req, res) => {
  const { testId } = req.params;
  const userId = req.user._id;

  // Get the user's best score
  const userBest = await TestAttempt.aggregate([
    {
      $match: {
        mock_test: new mongoose.Types.ObjectId(testId),
        user: new mongoose.Types.ObjectId(userId),
        status: 'COMPLETED',
      },
    },
    {
      $group: {
        _id: '$user',
        best_score: { $max: '$score' },
        best_percentage: { $max: '$percentage' },
        total_attempts: { $sum: 1 },
      },
    },
  ]);

  if (!userBest.length) {
    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { rank: null, message: 'No completed attempts found' },
          'Rank not available',
        ),
      );
  }

  const myBestScore = userBest[0].best_score;

  // Count how many users have a higher best score
  const higherScoreUsers = await TestAttempt.aggregate([
    {
      $match: {
        mock_test: new mongoose.Types.ObjectId(testId),
        status: 'COMPLETED',
      },
    },
    {
      $group: {
        _id: '$user',
        best_score: { $max: '$score' },
      },
    },
    {
      $match: {
        best_score: { $gt: myBestScore },
      },
    },
    { $count: 'count' },
  ]);

  const rank = (higherScoreUsers[0]?.count || 0) + 1;

  // Total participants
  const totalParticipants = await TestAttempt.aggregate([
    {
      $match: {
        mock_test: new mongoose.Types.ObjectId(testId),
        status: 'COMPLETED',
      },
    },
    {
      $group: { _id: '$user' },
    },
    { $count: 'count' },
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        rank,
        best_score: userBest[0].best_score,
        best_percentage: userBest[0].best_percentage,
        total_attempts: userBest[0].total_attempts,
        total_participants: totalParticipants[0]?.count || 0,
      },
      'Your rank fetched successfully',
    ),
  );
});
