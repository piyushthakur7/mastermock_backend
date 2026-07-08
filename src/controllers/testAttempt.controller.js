import { TestAttempt } from '../models/testAttempt.model.js';
import { MockTest } from '../models/mockTest.model.js';
import { Purchase } from '../models/purchase.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { scheduleAutoSubmit } from '../jobs/examQueue.js';

// @desc    Start a test attempt
// @route   POST /api/v1/attempts/start
// @access  Private/Student
export const startTest = asyncHandler(async (req, res) => {
  const { mock_test_id } = req.body;
  const userId = req.user._id;

  const mockTest = await MockTest.findOne({
    _id: mock_test_id,
    isDeleted: false,
    is_active: true,
  });
  if (!mockTest) throw new ApiError(404, 'Mock test not found or inactive');

  let activeAttempt = await TestAttempt.findOne({
    user: userId,
    mock_test: mock_test_id,
    status: 'IN_PROGRESS',
  });

  // Check if paid test requires purchase
  if (mockTest.access_type === 'paid') {
    if (mockTest.start_time && new Date() < new Date(mockTest.start_time)) {
      throw new ApiError(
        403,
        'This test is not available yet. Please wait for the scheduled start time.',
      );
    }
    if (mockTest.end_time && new Date() > new Date(mockTest.end_time)) {
      throw new ApiError(
        403,
        'The scheduled time window for this test has ended.',
      );
    }
    const purchaseCount = await Purchase.countDocuments({
      user: userId,
      item_id: mock_test_id,
      item_type: 'MockTest',
      status: 'ACTIVE',
    });
    if (purchaseCount === 0) {
      throw new ApiError(403, 'This is a paid test. Please purchase it first.');
    }

    const attemptCount = await TestAttempt.countDocuments({
      user: userId,
      mock_test: mock_test_id,
    });

    // If they don't have an IN_PROGRESS attempt, check if they have unused purchases
    if (!activeAttempt && attemptCount >= purchaseCount) {
      throw new ApiError(
        403,
        'Maximum attempt limit reached. Please purchase the test again to retake it.',
      );
    }
  }

  if (!activeAttempt) {
    activeAttempt = await TestAttempt.create({
      user: userId,
      mock_test: mock_test_id,
      started_at: new Date(),
      status: 'IN_PROGRESS',
      answers: [],
    });

    // Schedule BullMQ auto-submit job
    await scheduleAutoSubmit(activeAttempt._id, mockTest.duration_minutes);
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

  const mockTest = await MockTest.findById(attempt.mock_test);

  // Find the question and option
  const question = mockTest.questions.find(
    (q) => q._id.toString() === question_id,
  );
  if (!question) throw new ApiError(404, 'Question not found in this test');

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
  });
  if (!attempt) throw new ApiError(404, 'Attempt not found');

  return res.status(200).json(new ApiResponse(200, attempt, 'Attempt fetched'));
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

  const mockTest = await MockTest.findById(attempt.mock_test);
  let score = 0;

  // Calculate score
  attempt.answers.forEach((answer) => {
    const question = mockTest.questions.find(
      (q) => q._id.toString() === answer.question_id.toString(),
    );
    if (question && answer.selected_option_id) {
      const selectedOption = question.options.find(
        (o) => o._id.toString() === answer.selected_option_id.toString(),
      );
      if (selectedOption && selectedOption.is_correct) {
        answer.is_correct = true;
        score += question.marks;
      } else if (mockTest.negative_marking) {
        score -= mockTest.negative_marks_per_wrong;
      }
    }
  });

  attempt.score = Math.max(0, score);
  attempt.percentage = (attempt.score / mockTest.total_marks) * 100;

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
      path: 'mock_test',
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
      test: obj.mock_test,
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
