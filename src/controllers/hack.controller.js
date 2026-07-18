import mongoose from 'mongoose';
import { Hack } from '../models/hack.model.js';
import { Purchase } from '../models/purchase.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// --- HACK ADMIN ---

export const createHack = asyncHandler(async (req, res) => {
  const hack = await Hack.create({
    ...req.body,
    created_by: req.user._id,
  });
  return res
    .status(201)
    .json(new ApiResponse(201, hack, 'Hack created successfully'));
});

export const updateHack = asyncHandler(async (req, res) => {
  const hack = await Hack.findOneAndUpdate(
    { _id: req.params.id, isDeleted: false },
    { $set: req.body },
    { new: true, runValidators: true },
  );
  if (!hack) throw new ApiError(404, 'Hack not found');
  return res
    .status(200)
    .json(new ApiResponse(200, hack, 'Hack updated successfully'));
});

export const deleteHack = asyncHandler(async (req, res) => {
  const hack = await Hack.findOneAndUpdate(
    { _id: req.params.id, isDeleted: false },
    { $set: { isDeleted: true, deletedAt: new Date() } },
    { new: true },
  );
  if (!hack) throw new ApiError(404, 'Hack not found');
  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'Hack deleted successfully'));
});

export const publishHack = asyncHandler(async (req, res) => {
  const hack = await Hack.findOneAndUpdate(
    { _id: req.params.id, isDeleted: false },
    { $set: { is_active: true } },
    { new: true },
  );
  if (!hack) throw new ApiError(404, 'Hack not found');
  return res
    .status(200)
    .json(new ApiResponse(200, hack, 'Hack published successfully'));
});

export const unpublishHack = asyncHandler(async (req, res) => {
  const hack = await Hack.findOneAndUpdate(
    { _id: req.params.id, isDeleted: false },
    { $set: { is_active: false } },
    { new: true },
  );
  if (!hack) throw new ApiError(404, 'Hack not found');
  return res
    .status(200)
    .json(new ApiResponse(200, hack, 'Hack unpublished successfully'));
});

// --- QUESTIONS ADMIN ---

export const addQuestion = asyncHandler(async (req, res) => {
  const hack = await Hack.findOne({
    _id: req.params.id,
    isDeleted: false,
  });
  if (!hack) throw new ApiError(404, 'Hack not found');

  hack.questions.push(req.body);
  await hack.save();

  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        hack.questions[hack.questions.length - 1],
        'Question added successfully',
      ),
    );
});

export const updateQuestion = asyncHandler(async (req, res) => {
  const { id, questionId } = req.params;

  const hack = await Hack.findOneAndUpdate(
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

  if (!hack) throw new ApiError(404, 'Hack or Question not found');

  const updatedQuestion = hack.questions.find(
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

  const hack = await Hack.findOneAndUpdate(
    { _id: id, isDeleted: false },
    { $pull: { questions: { _id: questionId } } },
    { new: true },
  );

  if (!hack) throw new ApiError(404, 'Hack not found');

  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'Question deleted successfully'));
});

export const bulkUploadQuestions = asyncHandler(async (req, res) => {
  const { questions } = req.body;

  const hack = await Hack.findOne({
    _id: req.params.id,
    isDeleted: false,
  });
  if (!hack) throw new ApiError(404, 'Hack not found');

  hack.questions.push(...questions);
  await hack.save();

  return res
    .status(201)
    .json(new ApiResponse(201, hack, 'Questions uploaded successfully'));
});

// --- STUDENT / PUBLIC ---

// Where a hack sits relative to its scheduled window right now.
// 'unscheduled' = no window set, always available once published.
export const getScheduleStatus = (hack, now = new Date()) => {
  if (!hack.start_time && !hack.end_time) return 'unscheduled';
  if (hack.start_time && now < new Date(hack.start_time)) return 'upcoming';
  if (hack.end_time && now > new Date(hack.end_time)) return 'ended';
  return 'live';
};

export const getHacks = asyncHandler(async (req, res) => {
  const now = new Date();
  const filter = { isDeleted: false };
  const isAdmin = req.user && req.user.role === 'ADMIN';
  if (!isAdmin) {
    filter.is_active = true;
    // Ended scheduled tests disappear from student listings. Upcoming tests
    // stay visible so the UI can show "coming soon" (start is blocked
    // server-side in checkAccess/startTest).
    filter.$or = [{ end_time: null }, { end_time: { $gt: now } }];
  }

  if (req.query.access_type) {
    filter.access_type = req.query.access_type;
  }
  if (req.query.category) {
    filter.category = req.query.category;
  }
  // Publishing is stored as is_active; accept the PUBLISHED/DRAFT vocabulary
  // the admin UI sends rather than silently ignoring it. Students are pinned
  // to is_active: true above, so this only widens/narrows the admin view.
  if (isAdmin && req.query.status) {
    const status = String(req.query.status).toUpperCase();
    if (status === 'PUBLISHED') filter.is_active = true;
    else if (status === 'DRAFT') filter.is_active = false;
  }

  let query = Hack.find(filter)
    // Hide correct answers from students, and don't hand out the admin's user
    // id — it is the one thing an attacker needs to target an account.
    .select(isAdmin ? '' : '-questions.options.is_correct -created_by')
    .sort({ createdAt: -1 });

  if (req.query.limit) {
    query = query.limit(parseInt(req.query.limit, 10));
  }

  const hacks = await query;

  // Attach schedule_status + server_time so clients don't depend on the
  // student's device clock to decide upcoming/live/ended.
  const payload = hacks.map((h) => ({
    ...h.toObject(),
    schedule_status: getScheduleStatus(h, now),
    server_time: now.toISOString(),
  }));

  return res
    .status(200)
    .json(new ApiResponse(200, payload, 'Hacks fetched successfully'));
});

export const getHackById = asyncHandler(async (req, res) => {
  const filter = { _id: req.params.id, isDeleted: false };
  if (!req.user || req.user.role !== 'ADMIN') filter.is_active = true;

  const hack = await Hack.findOne(filter).select(
    req.user?.role !== 'ADMIN'
      ? '-questions.options.is_correct -created_by'
      : '',
  ); // Hide answers (and the author's user id) unless admin

  if (!hack) throw new ApiError(404, 'Hack not found');

  return res
    .status(200)
    .json(new ApiResponse(200, hack, 'Hack fetched successfully'));
});

// --- STUDENT: PURCHASED TESTS ---

export const getMyPurchasedHacks = asyncHandler(async (req, res) => {
  const purchases = await Purchase.find({
    user: req.user._id,
    item_type: 'Hack',
    status: 'ACTIVE',
  });

  const testIds = purchases.map((p) => p.item_id);

  const hacks = await Hack.find({
    _id: { $in: testIds },
    isDeleted: false,
    is_active: true,
  })
    .select('-questions.options.is_correct')
    .sort({ createdAt: -1 });

  return res
    .status(200)
    .json(new ApiResponse(200, hacks, 'Purchased hacks fetched successfully'));
});

// --- STUDENT: CHECK ACCESS ---

export const checkAccess = asyncHandler(async (req, res) => {
  const hack = await Hack.findOne({
    _id: req.params.id,
    isDeleted: false,
    is_active: true,
  });

  if (!hack) throw new ApiError(404, 'Hack not found');

  let hasAccess = false;
  let reason = '';
  let attemptExhausted = false;
  let hasPurchased = false;

  if (hack.access_type === 'free') {
    hasAccess = true;
    reason = 'Free test — no purchase required';
  } else {
    const purchase = await Purchase.findOne({
      user: req.user._id,
      item_id: hack._id,
      item_type: 'Hack',
      status: 'ACTIVE',
    });

    if (purchase) {
      hasPurchased = true;
      const attemptCount = await mongoose.model('TestAttempt').countDocuments({
        user: req.user._id,
        hack: hack._id,
      });

      if (attemptCount >= 1) {
        hasAccess = false;
        attemptExhausted = true;
        reason = 'Paid test already attempted (One-time attempt only)';
      } else {
        hasAccess = true;
        reason = 'Paid hack — purchase verified';
      }
    } else {
      hasAccess = false;
      reason = 'Paid hack — purchase required';
    }
  }

  // Scheduled window gate: has_access means "can start RIGHT NOW", so an
  // upcoming or ended window overrides everything above. Purchase state is
  // reported separately so the UI can still sell an upcoming paid test.
  const now = new Date();
  const scheduleStatus = getScheduleStatus(hack, now);
  if (hasAccess && scheduleStatus === 'upcoming') {
    hasAccess = false;
    reason =
      'This test has not started yet. Please wait for the scheduled start time.';
  } else if (scheduleStatus === 'ended') {
    hasAccess = false;
    reason = 'The scheduled time window for this test has ended.';
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        has_access: hasAccess,
        access_type: hack.access_type,
        price: hack.price,
        reason,
        attempt_exhausted: attemptExhausted,
        has_purchased: hasPurchased,
        schedule_status: scheduleStatus,
        start_time: hack.start_time || null,
        end_time: hack.end_time || null,
        server_time: now.toISOString(),
      },
      'Access check completed',
    ),
  );
});
