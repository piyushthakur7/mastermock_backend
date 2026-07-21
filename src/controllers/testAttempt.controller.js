import { TestAttempt } from '../models/testAttempt.model.js';
import { Hack } from '../models/hack.model.js';
import { Purchase } from '../models/purchase.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { scoreAttempt } from '../services/scoring.service.js';
import {
  finalizeAttempt,
  finalizeIfExpired,
} from '../services/attempt.service.js';

const ATTEMPT_POPULATE = {
  path: 'hack',
  select: 'title course',
  populate: { path: 'course', select: 'title' },
};

// The results page reads `test`, `totalAttempted` and `correctAnswers`, none
// of which exist on the raw document.
const shapeAttempt = (attempt) => {
  const obj =
    typeof attempt.toObject === 'function' ? attempt.toObject() : attempt;
  const answers = obj.answers || [];

  return {
    ...obj,
    test: obj.hack,
    totalAttempted: answers.filter((a) => a.selected_option_id).length,
    correctAnswers: answers.filter((a) => a.is_correct).length,
  };
};

// @desc    Start a test attempt
// @route   POST /api/v1/attempts/start
// @access  Private/Student
export const startTest = asyncHandler(async (req, res) => {
  const hack_id = req.body.hack_id || req.body.mock_test_id; // Support both for now
  const userId = req.user._id;

  const hack = await Hack.findOne({
    _id: hack_id,
    isDeleted: false,
    is_active: true,
  });
  if (!hack) throw new ApiError(404, 'Hack not found or inactive');

  // Scheduled window applies to every test (free or paid) that has one set.
  const now = new Date();
  if (hack.start_time && now < new Date(hack.start_time)) {
    throw new ApiError(
      403,
      'This test has not started yet. Please wait for the scheduled start time.',
    );
  }
  // `>=`, not `>`: starting at exactly the close instant used to be allowed,
  // and then got rounded up to a full minute of extra time past the window.
  if (hack.end_time && now >= new Date(hack.end_time)) {
    throw new ApiError(
      403,
      'The scheduled time window for this test has ended.',
    );
  }

  let activeAttempt = await TestAttempt.findOne({
    user: userId,
    hack: hack_id,
    status: 'IN_PROGRESS',
  });

  // A stale IN_PROGRESS row is not a resumable attempt — close it out first so
  // the one-attempt rule below counts it.
  if (activeAttempt) {
    const finalized = await finalizeIfExpired(activeAttempt);
    if (finalized) activeAttempt = null;
  }

  // Check if paid test requires purchase
  if (hack.access_type === 'paid') {
    const purchaseCount = await Purchase.countDocuments({
      user: userId,
      item_id: hack_id,
      item_type: 'Hack',
      status: 'ACTIVE',
    });
    if (purchaseCount === 0) {
      throw new ApiError(403, 'This is a paid hack. Please purchase it first.');
    }

    const attemptCount = await TestAttempt.countDocuments({
      user: userId,
      hack: hack_id,
    });

    // If they don't have an IN_PROGRESS attempt, check if they have already attempted it
    if (!activeAttempt && attemptCount >= 1) {
      throw new ApiError(
        403,
        'This paid test has already been attempted. Only one attempt is allowed.',
      );
    }
  }

  if (!activeAttempt) {
    // Deadline for auto-submit, clamped exactly to the window close. The old
    // Math.ceil(minutesUntilClose) rounded *up*, so every late start overran
    // the window by up to 59 seconds; computing the two instants and taking
    // the earlier one has no rounding drift at all.
    let expiresAt = new Date(Date.now() + hack.duration_minutes * 60 * 1000);
    if (hack.end_time) {
      const windowClose = new Date(hack.end_time);
      if (expiresAt > windowClose) expiresAt = windowClose;
    }

    try {
      activeAttempt = await TestAttempt.create({
        user: userId,
        hack: hack_id,
        started_at: new Date(),
        expires_at: expiresAt,
        status: 'IN_PROGRESS',
        answers: [],
      });
    } catch (error) {
      if (error?.code === 11000) {
        activeAttempt = await TestAttempt.findOne({
          user: userId,
          hack: hack_id,
          status: 'IN_PROGRESS',
        });
      }
      if (!activeAttempt) throw error;
    }
  }

  return res
    .status(201)
    .json(new ApiResponse(201, activeAttempt, 'Test started successfully'));
});

// @desc    Save or update an answer
// @route   PUT /api/v1/attempts/:attemptId/answer
// @access  Private/Student
export const saveAnswer = asyncHandler(async (req, res) => {
  const { attemptId } = req.params;
  const { question_id, selected_option_id, is_marked_for_review } = req.body;

  const attempt = await TestAttempt.findOne({
    _id: attemptId,
    user: req.user._id,
    status: 'IN_PROGRESS',
  });
  if (!attempt) throw new ApiError(404, 'Active test attempt not found');

  if (await finalizeIfExpired(attempt)) {
    throw new ApiError(400, 'Time is up. The test has been auto-submitted.');
  }

  const hack = await Hack.findById(attempt.hack);
  if (!hack)
    throw new ApiError(404, 'The test for this attempt no longer exists');

  // Find the question and option
  const question = hack.questions.find((q) => q._id.toString() === question_id);
  if (!question) throw new ApiError(404, 'Question not found in this hack');

  let selected_option_text = null;
  if (selected_option_id) {
    const option = question.options.find(
      (o) => o._id.toString() === selected_option_id,
    );
    if (!option) throw new ApiError(404, 'Option not found');
    selected_option_text = option.text;
  }

  // Write through an atomic update guarded on IN_PROGRESS so an answer can
  // never land on an attempt the sweeper has already finalized.
  const existingAnswerIndex = attempt.answers.findIndex(
    (a) => a.question_id.toString() === question_id,
  );

  const answerDoc = {
    question_id,
    question_text: question.text,
    selected_option_id: selected_option_id || null,
    selected_option_text,
    is_marked_for_review: Boolean(is_marked_for_review),
    answered_at: new Date(),
  };

  const update =
    existingAnswerIndex !== -1
      ? { $set: { [`answers.${existingAnswerIndex}`]: answerDoc } }
      : { $push: { answers: answerDoc } };

  const updated = await TestAttempt.findOneAndUpdate(
    { _id: attempt._id, status: 'IN_PROGRESS' },
    update,
    { new: true },
  );

  if (!updated) {
    throw new ApiError(400, 'Time is up. The test has been auto-submitted.');
  }

  return res
    .status(200)
    .json(new ApiResponse(200, updated.answers, 'Answer saved successfully'));
});

// @desc    Submit test manually
// @route   POST /api/v1/attempts/:attemptId/submit
// @access  Private/Student
export const submitTest = asyncHandler(async (req, res) => {
  const { attemptId } = req.params;

  const existing = await TestAttempt.findOne({
    _id: attemptId,
    user: req.user._id,
  });
  if (!existing) throw new ApiError(404, 'Test attempt not found');

  // Idempotent: a duplicate click, or a submit that races the auto-submit
  // sweeper, returns the finalized attempt instead of a 404.
  if (existing.status !== 'IN_PROGRESS') {
    return res
      .status(200)
      .json(new ApiResponse(200, existing, 'Test already submitted'));
  }

  // An attempt past its deadline is recorded as finishing *at* the deadline.
  // submitTest used to skip the expiry check entirely and stamp completed_at
  // with the current time, producing completions dated after their own expiry.
  const isExpired = existing.expires_at && existing.expires_at <= new Date();

  const finalized = await finalizeAttempt(existing._id, {
    completedAt: isExpired ? existing.expires_at : new Date(),
  });

  const attempt = finalized || (await TestAttempt.findById(existing._id));

  return res
    .status(200)
    .json(new ApiResponse(200, attempt, 'Test submitted successfully'));
});

// @desc    Get current attempt
// @route   GET /api/v1/attempts/:attemptId
// @access  Private/Student
export const getAttempt = asyncHandler(async (req, res) => {
  let attempt = await TestAttempt.findOne({
    _id: req.params.attemptId,
    user: req.user._id,
  }).populate(ATTEMPT_POPULATE);
  if (!attempt) throw new ApiError(404, 'Attempt not found');

  // Re-read after a lazy finalize, otherwise the response would be built from
  // the pre-scoring copy still held in memory.
  if (await finalizeIfExpired(attempt)) {
    attempt = await TestAttempt.findById(attempt._id).populate(
      ATTEMPT_POPULATE,
    );
  }

  return res
    .status(200)
    .json(new ApiResponse(200, shapeAttempt(attempt), 'Attempt fetched'));
});

// @desc    Evaluate test results
// @route   POST /api/v1/attempts/:attemptId/evaluate
// @access  Private/Student
export const evaluateTest = asyncHandler(async (req, res) => {
  const attempt = await TestAttempt.findOne({
    _id: req.params.attemptId,
    user: req.user._id,
  });
  if (!attempt) throw new ApiError(404, 'Attempt not found');

  if (attempt.status !== 'COMPLETED') {
    throw new ApiError(400, 'Test is not completed yet');
  }

  const hack = await Hack.findById(attempt.hack);
  if (!hack)
    throw new ApiError(404, 'The test for this attempt no longer exists');

  scoreAttempt(attempt, hack);
  await attempt.save();

  return res
    .status(200)
    .json(new ApiResponse(200, attempt, 'Test evaluated successfully'));
});

// @desc    Get all attempts for the logged-in student
// @route   GET /api/v1/attempts/my
// @access  Private/Student
export const getMyAttempts = asyncHandler(async (req, res) => {
  // Close out anything that expired while the student was away. On serverless
  // there is no sweeper at all, so this is the only thing that finalizes them.
  const expired = await TestAttempt.find({
    user: req.user._id,
    status: 'IN_PROGRESS',
    expires_at: { $lte: new Date() },
  }).select('_id expires_at');

  for (const stale of expired) {
    await finalizeAttempt(stale._id, { completedAt: stale.expires_at });
  }

  const attempts = await TestAttempt.find({ user: req.user._id })
    .sort({ completed_at: -1, started_at: -1 })
    .populate(ATTEMPT_POPULATE);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { data: attempts.map(shapeAttempt) },
        'My attempts fetched successfully',
      ),
    );
});

// @desc    Get all attempts (Admin only)
// @route   GET /api/v1/attempts
// @access  Private/Admin
export const getAllAttempts = asyncHandler(async (req, res) => {
  const limit = Math.min(
    Math.max(parseInt(req.query.limit, 10) || 100, 1),
    500,
  );
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const skip = (page - 1) * limit;

  const [attempts, total] = await Promise.all([
    TestAttempt.find()
      .sort({ started_at: -1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: 'user', select: 'full_name email' })
      .populate({
        path: 'hack',
        select: 'title course duration_minutes total_marks',
        populate: { path: 'course', select: 'title' },
      }),
    TestAttempt.countDocuments(),
  ]);

  const formatted = attempts.map((att) => {
    const shaped = shapeAttempt(att);
    return { ...shaped, student: shaped.user };
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        data: formatted,
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit) || 1,
      },
      'All attempts fetched successfully',
    ),
  );
});
