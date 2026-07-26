import { TestAttempt } from '../models/testAttempt.model.js';
import { Hack } from '../models/hack.model.js';
import { Purchase } from '../models/purchase.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { scoreAttempt } from '../services/scoring.service.js';

// Lazily enforce the attempt deadline: the background sweeper completes
// expired attempts once a minute, but a request can land in between (or the
// sweeper may be disabled on serverless), so controllers finalize on access.
const finalizeIfExpired = async (attempt) => {
  if (
    attempt &&
    attempt.status === 'IN_PROGRESS' &&
    attempt.expires_at &&
    attempt.expires_at <= new Date()
  ) {
    attempt.status = 'COMPLETED';
    attempt.completed_at = attempt.expires_at;
    // Score at completion — the leaderboard reads COMPLETED attempts
    // directly, so an unscored completion would show up as 0.
    const hack = await Hack.findById(attempt.hack);
    if (hack) scoreAttempt(attempt, hack);
    await attempt.save();
    return true;
  }
  return false;
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
  if (hack.end_time && now > new Date(hack.end_time)) {
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
    // Deadline for auto-submit. If the test has a scheduled end_time, clamp
    // the attempt to it — a student starting late gets only the time
    // remaining in the window, so no attempt runs past the window close.
    let effectiveMinutes = hack.duration_minutes;
    if (hack.end_time) {
      const minutesUntilClose =
        (new Date(hack.end_time).getTime() - Date.now()) / 60000;
      effectiveMinutes = Math.max(
        1,
        Math.min(hack.duration_minutes, Math.ceil(minutesUntilClose)),
      );
    }

    activeAttempt = await TestAttempt.create({
      user: userId,
      hack: hack_id,
      started_at: new Date(),
      expires_at: new Date(Date.now() + effectiveMinutes * 60 * 1000),
      status: 'IN_PROGRESS',
      answers: [],
    });
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

  // Check if answer exists in snapshot
  const existingAnswerIndex = attempt.answers.findIndex(
    (a) => a.question_id.toString() === question_id,
  );

  if (existingAnswerIndex !== -1) {
    // Update Answer
    attempt.answers[existingAnswerIndex].selected_option_id =
      selected_option_id;
    attempt.answers[existingAnswerIndex].selected_option_text =
      selected_option_text;
    attempt.answers[existingAnswerIndex].is_marked_for_review =
      is_marked_for_review;
    attempt.answers[existingAnswerIndex].answered_at = new Date();
  } else {
    // Save New Answer
    attempt.answers.push({
      question_id,
      question_text: question.text,
      selected_option_id,
      selected_option_text,
      is_marked_for_review,
      answered_at: new Date(),
    });
  }

  await attempt.save();

  return res
    .status(200)
    .json(new ApiResponse(200, attempt.answers, 'Answer saved successfully'));
});

// @desc    Submit test manually
// @route   POST /api/v1/attempts/:attemptId/submit
// @access  Private/Student
export const submitTest = asyncHandler(async (req, res) => {
  const { attemptId } = req.params;

  const attempt = await TestAttempt.findOne({
    _id: attemptId,
    user: req.user._id,
    status: 'IN_PROGRESS',
  });
  if (!attempt) throw new ApiError(404, 'Active test attempt not found');

  attempt.status = 'COMPLETED';
  attempt.completed_at = new Date();
  // Score at completion so the leaderboard never sees an unscored attempt;
  // if the hack was deleted mid-attempt, still complete (score stays 0).
  const hack = await Hack.findById(attempt.hack);
  if (hack) scoreAttempt(attempt, hack);
  await attempt.save();

  return res
    .status(200)
    .json(new ApiResponse(200, attempt, 'Test submitted successfully'));
});

// @desc    Get current attempt
// @route   GET /api/v1/attempts/:attemptId
// @access  Private/Student
export const getAttempt = asyncHandler(async (req, res) => {
  const attempt = await TestAttempt.findOne({
    _id: req.params.attemptId,
    user: req.user._id,
  }).populate({
    path: 'hack',
    select: 'title course',
    populate: { path: 'course', select: 'title' },
  });
  if (!attempt) throw new ApiError(404, 'Attempt not found');

  await finalizeIfExpired(attempt);

  // Same shaping as getMyAttempts — the results page reads `test`,
  // `totalAttempted`, and `correctAnswers`, none of which exist on the raw
  // document.
  const obj = attempt.toObject();
  const totalAttempted = obj.answers ? obj.answers.length : 0;
  const correctAnswers = obj.answers
    ? obj.answers.filter((a) => a.is_correct).length
    : 0;

  // The answer key is released here, and only here: the attempt is finished
  // and the query above is scoped to `user: req.user._id`, so a student can
  // only ever see the key for a test they can no longer be taking. Every
  // /hacks endpoint still strips `is_correct` — that strip is what stops a
  // candidate reading the key out of the network tab mid-exam, so it must
  // not be undone to serve the results page.
  let questions;
  if (obj.status === 'COMPLETED') {
    // `hack` is populated as 'title course', so the questions aren't on it.
    const hackId = obj.hack?._id || obj.hack;
    const hackWithKey = hackId
      ? await Hack.findById(hackId).select('questions')
      : null;

    if (hackWithKey) {
      // Every question on the hack, not just the answered ones — `answers`
      // holds only the questions the student touched, so building the
      // review off it silently drops every skipped question.
      questions = hackWithKey.questions.map((q) => {
        const correct = q.options.find((o) => o.is_correct);
        return {
          _id: q._id,
          text: q.text,
          marks: q.marks,
          explanation: q.explanation ?? null,
          options: q.options.map((o) => ({
            _id: o._id,
            text: o.text,
            is_correct: o.is_correct,
          })),
          correct_option_id: correct ? correct._id : null,
          correct_option_text: correct ? correct.text : null,
        };
      });

      const byId = new Map(questions.map((q) => [q._id.toString(), q]));
      obj.answers = (obj.answers || []).map((a) => {
        const q = byId.get(a.question_id?.toString());
        return {
          ...a,
          correct_option_id: q ? q.correct_option_id : null,
          correct_option_text: q ? q.correct_option_text : null,
          explanation: q ? q.explanation : null,
        };
      });
    }
  }

  const body = { ...obj, test: obj.hack, totalAttempted, correctAnswers };
  // Absent entirely while the test is still in progress.
  if (questions) body.questions = questions;

  return res.status(200).json(new ApiResponse(200, body, 'Attempt fetched'));
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
  const attempts = await TestAttempt.find({ user: req.user._id })
    .sort({ completed_at: -1, started_at: -1 })
    .populate({
      path: 'hack',
      select: 'title course',
      populate: { path: 'course', select: 'title' },
    });

  const formattedAttempts = attempts.map((att) => {
    const obj = att.toObject();
    const totalAttempted = obj.answers ? obj.answers.length : 0;
    const correctAnswers = obj.answers
      ? obj.answers.filter((a) => a.is_correct).length
      : 0;

    return {
      ...obj,
      test: obj.hack,
      totalAttempted,
      correctAnswers,
    };
  });

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { data: formattedAttempts },
        'My attempts fetched successfully',
      ),
    );
});

// @desc    Get all attempts (Admin only)
// @route   GET /api/v1/attempts
// @access  Private/Admin
export const getAllAttempts = asyncHandler(async (req, res) => {
  const attempts = await TestAttempt.find()
    .sort({ started_at: -1 })
    .populate({
      path: 'user',
      select: 'full_name email',
    })
    .populate({
      path: 'hack',
      select: 'title course duration_minutes total_marks',
      populate: { path: 'course', select: 'title' },
    });

  const formattedAttempts = attempts.map((att) => {
    const obj = att.toObject();
    const totalAttempted = obj.answers ? obj.answers.length : 0;
    const correctAnswers = obj.answers
      ? obj.answers.filter((a) => a.is_correct).length
      : 0;

    return {
      ...obj,
      test: obj.hack,
      student: obj.user,
      totalAttempted,
      correctAnswers,
    };
  });

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { data: formattedAttempts },
        'All attempts fetched successfully',
      ),
    );
});
