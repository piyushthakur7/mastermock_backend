import { TestAttempt } from '../models/testAttempt.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
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

  // Rank on each user's FIRST completed attempt, not their best.
  //
  // Free tests allow unlimited attempts, and GET /attempts/:id hands back the
  // full answer key once an attempt is COMPLETED. Ranking on $max score made
  // those three facts combine into a free win: submit a blank attempt, read
  // every correct answer off the results page, retake, and top a board that
  // pays out real rewards. A blank first attempt now IS the ranked score, so
  // there is nothing to gain by throwing one away.
  //
  // Retakes still run, still score, and still show up in the student's own
  // history and in total_attempts — they just don't move the board.
  const leaderboard = await TestAttempt.aggregate([
    {
      $match: {
        hack: new mongoose.Types.ObjectId(testId),
        status: 'COMPLETED',
      },
    },
    // $first below reads whatever this sort put at the head of each group.
    { $sort: { completed_at: 1, _id: 1 } },
    {
      $group: {
        _id: '$user',
        // Field names are unchanged so the frontend contract holds; what
        // changed is which attempt they come from.
        best_score: { $first: '$score' },
        best_percentage: { $first: '$percentage' },
        total_attempts: { $sum: 1 },
        first_attempt_at: { $first: '$completed_at' },
        last_attempt_at: { $max: '$completed_at' },
      },
    },
    // Tie-break on the ranked attempt itself: whoever set the score first
    // wins. Using last_attempt_at here would let a later retake change a
    // student's rank without changing their score.
    { $sort: { best_score: -1, first_attempt_at: 1 } },
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
    // No email here — the leaderboard is visible to every logged-in student,
    // so including it published the address of everyone who took the test.
    user: entry.user
      ? {
          _id: entry.user._id,
          full_name: entry.user.full_name,
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

  res.json(new ApiResponse(200, result, 'Leaderboard fetched'));
});

// @desc    Get the requesting user's rank for a specific test
// @route   GET /api/v1/leaderboard/:testId/my-rank
// @access  Private/Student
export const getMyRank = asyncHandler(async (req, res) => {
  const { testId } = req.params;
  const userId = req.user._id;

  // Without this a malformed id reaches the ObjectId constructor and throws a
  // raw BSONError, which surfaces as a 500 instead of a 400.
  if (!mongoose.Types.ObjectId.isValid(testId)) {
    return res.status(400).json(new ApiResponse(400, null, 'Invalid test ID'));
  }

  // The user's ranked attempt — their first completed one. See the comment in
  // getHackLeaderboard for why ranking is not on best score.
  const userBest = await TestAttempt.aggregate([
    {
      $match: {
        hack: new mongoose.Types.ObjectId(testId),
        user: new mongoose.Types.ObjectId(userId),
        status: 'COMPLETED',
      },
    },
    { $sort: { completed_at: 1, _id: 1 } },
    {
      $group: {
        _id: '$user',
        best_score: { $first: '$score' },
        best_percentage: { $first: '$percentage' },
        total_attempts: { $sum: 1 },
        first_attempt_at: { $first: '$completed_at' },
        last_attempt_at: { $max: '$completed_at' },
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
  const myFirstAttemptAt = userBest[0].first_attempt_at;

  // Count users ranked ahead of me, using the same ordering as the
  // leaderboard endpoint (ranked score desc, then earlier first attempt
  // wins) — otherwise a tied user sees a different rank here than on the
  // board.
  const higherScoreUsers = await TestAttempt.aggregate([
    {
      $match: {
        hack: new mongoose.Types.ObjectId(testId),
        status: 'COMPLETED',
      },
    },
    { $sort: { completed_at: 1, _id: 1 } },
    {
      $group: {
        _id: '$user',
        best_score: { $first: '$score' },
        first_attempt_at: { $first: '$completed_at' },
      },
    },
    {
      $match: {
        $or: [
          { best_score: { $gt: myBestScore } },
          {
            best_score: myBestScore,
            first_attempt_at: { $lt: myFirstAttemptAt },
          },
        ],
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
