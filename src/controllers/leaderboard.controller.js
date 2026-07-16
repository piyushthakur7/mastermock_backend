import { TestAttempt } from '../models/testAttempt.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { redis } from '../utils/redis.js';
import mongoose from 'mongoose';

// @desc    Get leaderboard for a hack (best score per user)
// @route   GET /api/v1/leaderboard/:testId?limit=100&page=1
// @access  Private/Student
export const getHackLeaderboard = asyncHandler(async (req, res) => {
  const { testId } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const page = parseInt(req.query.page) || 1;
  const skip = (page - 1) * limit;

  if (!mongoose.Types.ObjectId.isValid(testId)) {
    return res.status(400).json(new ApiResponse(400, null, 'Invalid test ID'));
  }

  // Redis logic to cache (safely wrapped)
  const cacheKey = `leaderboard:${testId}:${page}:${limit}`;
  if (redis) {
    try {
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
    } catch (err) {
      console.warn('Redis get error:', err.message);
    }
  }

  // Aggregate: group by user, take best score per user
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
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
  ]);

  const totalParticipants = leaderboard.length;

  // Assign rank based on index in memory
  const rankedLeaderboard = leaderboard.map((entry, index) => ({
    ...entry,
    rank: index + 1,
  }));

  // Paginate in memory
  let entries = rankedLeaderboard.slice(skip, skip + limit);

  // Reshape the entries for cleaner output
  entries = entries.map((entry) => ({
    rank: entry.rank,
    user: entry.user
      ? {
          _id: entry.user._id,
          full_name: entry.user.full_name,
          email: entry.user.email,
          profile_picture: entry.user.profile_picture,
        }
      : null,
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
    total_pages: Math.ceil(totalParticipants / limit) || 1,
  };

  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify(result), 'EX', 300); // 5 minutes cache
    } catch (err) {
      console.warn('Redis set error:', err.message);
    }
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
        hack: new mongoose.Types.ObjectId(testId),
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
        hack: new mongoose.Types.ObjectId(testId),
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
        hack: new mongoose.Types.ObjectId(testId),
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
