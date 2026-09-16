import { TestAttempt } from '../models/testAttempt.model.js';
import { Hack } from '../models/hack.model.js';
import { Purchase } from '../models/purchase.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { scoreAttempt } from '../services/scoring.service.js';
import { completeAttempt } from '../services/attempt.service.js';

// Answers carried on a submit are trusted up to the attempt's deadline plus
// this allowance, which covers the request that was already in flight when
// the exam screen's own timer reached zero. Any later and a student could keep
// changing answers after time was up just by holding back the submit.
const SUBMIT_GRACE_MS = 30 * 1000;

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
    // Score at completion — the leaderboard reads COMPLETED attempts
    // directly, so an unscored completion would show up as 0.
    const hack = await Hack.findById(attempt.hack);
    await completeAttempt(attempt, hack, attempt.expires_at);
    return true;
  }
  return false;
};

// Per-attempt counts for the results screens. Only answers with a selected
// option count as attempted: clearing a response leaves its row behind with a
// null selection, and counting those rows showed a cleared question as
// "wrong" beside a score that (correctly) never penalised it.
const answerCounts = (answers = []) => {
  const attempted = answers.filter((a) => a.selected_option_id);
  const correctAnswers = attempted.filter((a) => a.is_correct).length;
  return {
    totalAttempted: attempted.length,
    correctAnswers,
    wrongAnswers: attempted.length - correctAnswers,
  };
};

// Write one answer into an attempt that is still IN_PROGRESS, as conditional
// updates rather than load-modify-save().
//
// With save(), an answer request that loaded the attempt just before the
// student hit Submit would still save afterwards, pushing its answer into a
// COMPLETED, already-scored attempt (or pushing a duplicate row for a
// question the submit had written). Changing an existing answer also carried
// Mongoose's version check, so it failed outright whenever another answer had
// been added in between. Every write here is refused once the attempt is no
// longer IN_PROGRESS, and a question can only ever have one row.
const writeAnswer = async (attemptId, userId, question, fields) => {
  const inProgress = { _id: attemptId, user: userId, status: 'IN_PROGRESS' };
  const update = () =>
    TestAttempt.findOneAndUpdate(
      { ...inProgress, 'answers.question_id': question._id },
      {
        $inc: { __v: 1 },
        $set: Object.fromEntries(
          Object.entries(fields).map(([k, v]) => [`answers.$.${k}`, v]),
        ),
      },
      { new: true },
    );

  const updated = await update();
  if (updated) return updated;

  const pushed = await TestAttempt.findOneAndUpdate(
    { ...inProgress, 'answers.question_id': { $ne: question._id } },
    {
      $inc: { __v: 1 },
      $push: {
        answers: {
          question_id: question._id,
          question_text: question.text,
          ...fields,
        },
      },
    },
    { new: true },
  );
  if (pushed) return pushed;

  // A concurrent request added this question between the two writes above.
  return update();
};

// Fold the answers the exam screen was showing at submit time into the
// attempt before it is scored.
//
// Each click is saved by its own request, and a save that fails — a dropped
// connection, a throttled request, or simply the last answer still in flight
// when Submit lands — used to vanish without trace. The student saw their
// choice on screen and was scored as if they had skipped it. Taking the full
// answer sheet with the submit makes the score match what the student saw.
//
// Unknown questions or options (a stale screen after an admin edit) are
// ignored rather than failing the whole submit.
const mergeSubmittedAnswers = (attempt, submitted, hack) => {
  const now = new Date();

  for (const entry of submitted) {
    if (!entry) continue;
    const question = hack.questions.id(entry.question_id);
    if (!question) continue;

    const option = entry.selected_option_id
      ? question.options.id(entry.selected_option_id)
      : null;
    if (entry.selected_option_id && !option) continue;

    const existing = attempt.answers.find(
      (a) => a.question_id.toString() === question._id.toString(),
    );

    if (existing) {
      const unchanged =
        String(existing.selected_option_id || '') === String(option?._id || '');
      if (!unchanged) {
        existing.selected_option_id = option ? option._id : null;
        existing.selected_option_text = option ? option.text : null;
        existing.answered_at = now;
      }
    } else if (option) {
      // No row for an unanswered question: an empty row would read as
      // "attempted" anywhere that counts rows.
      attempt.answers.push({
        question_id: question._id,
        question_text: question.text,
        selected_option_id: option._id,
        selected_option_text: option.text,
        answered_at: now,
      });
    }
  }
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

  const saved = await writeAnswer(attempt._id, req.user._id, question, {
    selected_option_id: selected_option_id || null,
    selected_option_text,
    is_marked_for_review,
    answered_at: new Date(),
  });
  // The attempt was submitted between the lookup above and this write.
  if (!saved) throw new ApiError(404, 'Active test attempt not found');

  return res
    .status(200)
    .json(new ApiResponse(200, saved.answers, 'Answer saved successfully'));
});

// @desc    Submit test manually
// @route   POST /api/v1/attempts/:attemptId/submit
// @access  Private/Student
// @body    { answers?: [{ question_id, selected_option_id | null }] }
export const submitTest = asyncHandler(async (req, res) => {
  const { attemptId } = req.params;

  const attempt = await TestAttempt.findOne({
    _id: attemptId,
    user: req.user._id,
  });
  if (!attempt) throw new ApiError(404, 'Test attempt not found');

  // Already finished: a double tap, a retry after a dropped response, or the
  // auto-submit sweeper getting there first. The student's result exists, so
  // hand it back rather than a 404 the exam screen reports as a failed submit.
  if (attempt.status !== 'IN_PROGRESS') {
    return res
      .status(200)
      .json(new ApiResponse(200, attempt, 'Test already submitted'));
  }

  const hack = await Hack.findById(attempt.hack);

  const submitted = req.body?.answers;
  const withinDeadline =
    !attempt.expires_at ||
    Date.now() <= attempt.expires_at.getTime() + SUBMIT_GRACE_MS;
  // Score at completion so the leaderboard never sees an unscored attempt.
  const completed = await completeAttempt(
    attempt,
    hack,
    new Date(),
    hack && Array.isArray(submitted) && withinDeadline
      ? (current) => mergeSubmittedAnswers(current, submitted, hack)
      : undefined,
  );
  if (!completed) {
    const current = await TestAttempt.findById(attempt._id);
    return res
      .status(200)
      .json(new ApiResponse(200, current, 'Test already submitted'));
  }

  return res
    .status(200)
    .json(new ApiResponse(200, completed, 'Test submitted successfully'));
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
  // `totalAttempted`, `correctAnswers` and `wrongAnswers`, none of which exist
  // on the raw document.
  const obj = attempt.toObject();

  // Release the answer key, but ONLY for a finished attempt.
  //
  // Every hack endpoint strips `questions.options.is_correct` for students,
  // because GET /hacks/:id is what the live exam screen loads — leaving the
  // key in there would let a candidate read it out of the network tab
  // mid-test. That strip also left the results page with no way to show the
  // right answer, so it could only ever highlight the student's own choice.
  // Once the attempt is COMPLETED there is nothing left to cheat on, so this
  // hands back the full question set: every option, which one is correct, and
  // the explanation. Unanswered questions are included too — the answers array
  // only holds questions the student actually touched.
  let solutions = null;
  if (obj.status === 'COMPLETED') {
    const hackWithKey = await Hack.findById(obj.hack?._id || obj.hack).select(
      'questions',
    );

    if (hackWithKey) {
      solutions = hackWithKey.questions.map((q) => {
        const correctOption = q.options.find((o) => o.is_correct);
        return {
          _id: q._id,
          text: q.text,
          marks: q.marks,
          explanation: q.explanation,
          options: q.options.map((o) => ({
            _id: o._id,
            text: o.text,
            is_correct: o.is_correct,
          })),
          correct_option_id: correctOption ? correctOption._id : null,
          correct_option_text: correctOption ? correctOption.text : null,
        };
      });

      // Denormalise the key onto each saved answer as well, so a client that
      // reads the answers array alone still knows what the right choice was.
      const byQuestionId = new Map(solutions.map((q) => [q._id.toString(), q]));
      obj.answers = (obj.answers || []).map((a) => {
        const q = byQuestionId.get(a.question_id?.toString());
        return q
          ? {
              ...a,
              correct_option_id: q.correct_option_id,
              correct_option_text: q.correct_option_text,
              explanation: q.explanation,
            }
          : a;
      });
    }
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        ...obj,
        test: obj.hack,
        ...answerCounts(obj.answers),
        // Present only on a COMPLETED attempt.
        ...(solutions ? { questions: solutions } : {}),
      },
      'Attempt fetched',
    ),
  );
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
    return {
      ...obj,
      test: obj.hack,
      ...answerCounts(obj.answers),
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
    return {
      ...obj,
      test: obj.hack,
      student: obj.user,
      ...answerCounts(obj.answers),
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
