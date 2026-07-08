import { MockTest } from '../models/mockTest.model.js';
import { Purchase } from '../models/purchase.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// --- MOCK TEST ADMIN ---

export const createMockTest = asyncHandler(async (req, res) => {
  const mockTest = await MockTest.create({
    ...req.body,
    created_by: req.user._id,
  });
  return res
    .status(201)
    .json(new ApiResponse(201, mockTest, 'Mock Test created successfully'));
});

export const updateMockTest = asyncHandler(async (req, res) => {
  const mockTest = await MockTest.findOneAndUpdate(
    { _id: req.params.id, isDeleted: false },
    { $set: req.body },
    { new: true, runValidators: true },
  );
  if (!mockTest) throw new ApiError(404, 'Mock Test not found');
  return res
    .status(200)
    .json(new ApiResponse(200, mockTest, 'Mock Test updated successfully'));
});

export const deleteMockTest = asyncHandler(async (req, res) => {
  const mockTest = await MockTest.findOneAndUpdate(
    { _id: req.params.id, isDeleted: false },
    { $set: { isDeleted: true, deletedAt: new Date() } },
    { new: true },
  );
  if (!mockTest) throw new ApiError(404, 'Mock Test not found');
  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'Mock Test deleted successfully'));
});

export const publishMockTest = asyncHandler(async (req, res) => {
  const mockTest = await MockTest.findOneAndUpdate(
    { _id: req.params.id, isDeleted: false },
    { $set: { is_active: true } },
    { new: true },
  );
  if (!mockTest) throw new ApiError(404, 'Mock Test not found');
  return res
    .status(200)
    .json(new ApiResponse(200, mockTest, 'Mock Test published successfully'));
});

export const unpublishMockTest = asyncHandler(async (req, res) => {
  const mockTest = await MockTest.findOneAndUpdate(
    { _id: req.params.id, isDeleted: false },
    { $set: { is_active: false } },
    { new: true },
  );
  if (!mockTest) throw new ApiError(404, 'Mock Test not found');
  return res
    .status(200)
    .json(new ApiResponse(200, mockTest, 'Mock Test unpublished successfully'));
});

// --- QUESTIONS ADMIN ---

export const addQuestion = asyncHandler(async (req, res) => {
  const mockTest = await MockTest.findOne({
    _id: req.params.id,
    isDeleted: false,
  });
  if (!mockTest) throw new ApiError(404, 'Mock Test not found');

  mockTest.questions.push(req.body);
  await mockTest.save();

  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        mockTest.questions[mockTest.questions.length - 1],
        'Question added successfully',
      ),
    );
});

export const updateQuestion = asyncHandler(async (req, res) => {
  const { id, questionId } = req.params;

  const mockTest = await MockTest.findOneAndUpdate(
    { _id: id, 'questions._id': questionId, isDeleted: false },
    {
      $set: {
        'questions.$.text': req.body.text,
        'questions.$.marks': req.body.marks,
        'questions.$.explanation': req.body.explanation,
        'questions.$.options': req.body.options,
      },
    },
    { new: true },
  );

  if (!mockTest) throw new ApiError(404, 'Mock Test or Question not found');

  const updatedQuestion = mockTest.questions.find(
    (q) => q._id.toString() === questionId,
  );
  return res
    .status(200)
    .json(
      new ApiResponse(200, updatedQuestion, 'Question updated successfully'),
    );
});

export const deleteQuestion = asyncHandler(async (req, res) => {
  const { id, questionId } = req.params;

  const mockTest = await MockTest.findOneAndUpdate(
    { _id: id, isDeleted: false },
    { $pull: { questions: { _id: questionId } } },
    { new: true },
  );

  if (!mockTest) throw new ApiError(404, 'Mock Test not found');

  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'Question deleted successfully'));
});

export const bulkUploadQuestions = asyncHandler(async (req, res) => {
  const { questions } = req.body;

  const mockTest = await MockTest.findOne({
    _id: req.params.id,
    isDeleted: false,
  });
  if (!mockTest) throw new ApiError(404, 'Mock Test not found');

  mockTest.questions.push(...questions);
  await mockTest.save();

  return res
    .status(201)
    .json(new ApiResponse(201, mockTest, 'Questions uploaded successfully'));
});

// --- STUDENT / PUBLIC ---

export const getMockTests = asyncHandler(async (req, res) => {
  const filter = { isDeleted: false };
  if (!req.user || req.user.role !== 'ADMIN') filter.is_active = true;

  if (req.query.access_type) {
    filter.access_type = req.query.access_type;
  }
  if (req.query.category) {
    filter.category = req.query.category;
  }

  let query = MockTest.find(filter)
    .select('-questions.options.is_correct') // Hide correct answers for students
    .sort({ createdAt: -1 });

  if (req.query.limit) {
    query = query.limit(parseInt(req.query.limit, 10));
  }

  const mockTests = await query;

  return res
    .status(200)
    .json(new ApiResponse(200, mockTests, 'Mock tests fetched successfully'));
});

export const getMockTestById = asyncHandler(async (req, res) => {
  const filter = { _id: req.params.id, isDeleted: false };
  if (!req.user || req.user.role !== 'ADMIN') filter.is_active = true;

  const mockTest = await MockTest.findOne(filter).select(
    req.user?.role !== 'ADMIN' ? '-questions.options.is_correct' : '',
  ); // Hide answers unless admin

  if (!mockTest) throw new ApiError(404, 'Mock Test not found');

  return res
    .status(200)
    .json(new ApiResponse(200, mockTest, 'Mock test fetched successfully'));
});

// --- STUDENT: PURCHASED TESTS ---

export const getMyPurchasedTests = asyncHandler(async (req, res) => {
  const purchases = await Purchase.find({
    user: req.user._id,
    item_type: 'MockTest',
    status: 'ACTIVE',
  });

  const testIds = purchases.map((p) => p.item_id);

  const mockTests = await MockTest.find({
    _id: { $in: testIds },
    isDeleted: false,
    is_active: true,
  })
    .select('-questions.options.is_correct')
    .sort({ createdAt: -1 });

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        mockTests,
        'Purchased mock tests fetched successfully',
      ),
    );
});

// --- STUDENT: CHECK ACCESS ---

export const checkAccess = asyncHandler(async (req, res) => {
  const mockTest = await MockTest.findOne({
    _id: req.params.id,
    isDeleted: false,
    is_active: true,
  });

  if (!mockTest) throw new ApiError(404, 'Mock Test not found');

  let hasAccess = false;
  let reason = '';

  if (mockTest.access_type === 'free') {
    hasAccess = true;
    reason = 'Free test — no purchase required';
  } else {
    const purchase = await Purchase.findOne({
      user: req.user._id,
      item_id: mockTest._id,
      item_type: 'MockTest',
      status: 'ACTIVE',
    });
    hasAccess = !!purchase;
    reason = hasAccess
      ? 'Paid test — purchase verified'
      : 'Paid test — purchase required';
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        has_access: hasAccess,
        access_type: mockTest.access_type,
        price: mockTest.price,
        reason,
      },
      'Access check completed',
    ),
  );
});
