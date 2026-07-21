import { TestAttempt } from '../models/testAttempt.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import mongoose from 'mongoose';

/**
 * Shared ranking pipeline.
 *
 * Two things this fixes:
 *
 * 1. The grouped fields used to be independent $max accumulators, so
 *    best_score, best_percentage and the tiebreak timestamp could each come
 *    from a *different* attempt — a student whose best run was their first but
 *    who retook the test later was ranked by the later timestamp. Sorting
 *    before the group and taking $first makes every field describe the same
 *    single best attempt.
 *
 * 2. Rank was previously the array index, so tied students got 5th and 6th
 *    instead of joint 5th — and getMyRank computed rank a different way, so
 *    the two endpoints disagreed for exactly the users most likely to check.
 *    Both now share this pipeline, and $rank gives standard competition
 *    ranking (1, 2, 2, 4).
 *
 * Rank is decided by score alone, so an equal score is an equal rank. The
 * completion time only orders the display within a tie — breaking ties by a
 * couple of seconds and calling one student strictly better was arbitrary,
 * and it was being done on the wrong timestamp anyway.
 */
const rankingStages = (hackId) => [
  {
    $match: {
      hack: hackId,
      status: 'COMPLETED',
    },
  },
  { $sort: { score: -1, completed_at: 1 } },
  {
    $group: {
      _id: '$user',
      best_score: { $first: '$score' },
      best_percentage: { $first: '$percentage' },
      best_attempt_at: { $first: '$completed_at' },
      total_attempts: { $sum: 1 },
      last_attempt_at: { $max: '$completed_at' },
    },
  },
  {
    // $rank accepts exactly one sortBy field, which lines up with ranking on
    // score alone.
    $setWindowFields: {
      sortBy: { best_score: -1 },
      output: { rank: { $rank: {} } },
    },
  },
];

const shapeUser = (user) =>
  user
    ? {
        _id: user._id,
        // No email here — the leaderboard is visible to every logged-in
        // student, so including it published the address of everyone who took
        // the test.
        full_name: user.full_name,
        profile_picture: user.profile_picture,
      }
    : // A participant whose account was deleted. Keeping the row (rather than
      // dropping it) means everyone else's rank stays stable.
      { _id: null, full_name: 'Deleted user', profile_picture: null };

// @desc    Get leaderboard for a hack (best score per user)
// @route   GET /api/v1/leaderboard/:testId?limit=100&page=1
// @access  Private/Student
export const getHackLeaderboard = asyncHandler(async (req, res) => {
  const { testId } = req.params;
  const limit = Math.min(
    Math.max(parseInt(req.query.limit, 10) || 100, 1),
    500,
  );
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const skip = (page - 1) * limit;

  if (!mongoose.Types.ObjectId.isValid(testId)) {
    throw new ApiError(400, 'Invalid test ID');
  }

  const [result] = await TestAttempt.aggregate([
    ...rankingStages(new mongoose.Types.ObjectId(testId)),
    // Within a tied rank, whoever got there first is listed first.
    { $sort: { rank: 1, best_attempt_at: 1, _id: 1 } },
    {
      $facet: {
        // Paginate BEFORE the $lookup. The old version materialised every
        // participant, joined all of them to users, and then sliced the array
        // in Node — so a 50k-participant test did 50k joins per request.
        entries: [
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: 'users',
              localField: '_id',
              foreignField: '_id',
              as: 'user',
            },
          },
          { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        ],
        meta: [{ $count: 'total' }],
      },
    },
  ]);

  const totalParticipants = result?.meta?.[0]?.total || 0;

  const entries = (result?.entries || []).map((entry) => ({
    rank: entry.rank,
    user: shapeUser(entry.user),
    best_score: entry.best_score,
    best_percentage: entry.best_percentage,
    total_attempts: entry.total_attempts,
    last_attempt_at: entry.last_attempt_at,
    best_attempt_at: entry.best_attempt_at,
  }));

  return res.json(
    new ApiResponse(
      200,
      {
        entries,
        total_participants: totalParticipants,
        page,
        limit,
        total_pages: Math.ceil(totalParticipants / limit) || 1,
      },
      'Leaderboard fetched',
    ),
  );
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
    throw new ApiError(400, 'Invalid test ID');
  }

  // Reuse the exact pipeline the board uses, then pick this user out of it.
  // Recomputing rank with a separate counting query is what let the two
  // endpoints drift apart on ties in the first place.
  const [result] = await TestAttempt.aggregate([
    ...rankingStages(new mongoose.Types.ObjectId(testId)),
    {
      $facet: {
        me: [{ $match: { _id: new mongoose.Types.ObjectId(userId) } }],
        meta: [{ $count: 'total' }],
      },
    },
  ]);

  const me = result?.me?.[0];
  const totalParticipants = result?.meta?.[0]?.total || 0;

  if (!me) {
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          rank: null,
          best_score: null,
          best_percentage: null,
          total_attempts: 0,
          total_participants: totalParticipants,
          message: 'No completed attempts found',
        },
        'Rank not available',
      ),
    );
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        rank: me.rank,
        best_score: me.best_score,
        best_percentage: me.best_percentage,
        total_attempts: me.total_attempts,
        total_participants: totalParticipants,
      },
      'Your rank fetched successfully',
    ),
  );
});
