import { Hack } from '../models/hack.model.js';
import { Purchase } from '../models/purchase.model.js';
import { TestAttempt } from '../models/testAttempt.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// total_marks / total_questions are derived from the question list by a
// pre-save hook. Accepting them from the client would let an admin re-base
// every student's percentage by hand.
const stripDerivedFields = (body = {}) => {
  // eslint-disable-next-line no-unused-vars
  const { total_marks, total_questions, ...rest } = body;
  return rest;
};

// --- HACK ADMIN ---

export const createHack = asyncHandler(async (req, res) => {
  const hack = await Hack.create({
    ...stripDerivedFields(req.body),
    created_by: req.user._id,
  });
  return res
    .status(201)
    .json(new ApiResponse(201, hack, 'Hack created successfully'));
});

export const updateHack = asyncHandler(async (req, res) => {
  const hack = await Hack.findOneAndUpdate(
    { _id: req.params.id, isDeleted: false },
    { $set: stripDerivedFields(req.body) },
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
    { $set: { isDeleted: true, deletedAt: new Date(), is_active: false } },
    { new: true },
  );
  if (!hack) throw new ApiError(404, 'Hack not found');
  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'Hack deleted successfully'));
});

export const publishHack = asyncHandler(async (req, res) => {
  const hack = await Hack.findOne({ _id: req.params.id, isDeleted: false });
  if (!hack) throw new ApiError(404, 'Hack not found');

  // Publishing is the last point at which these problems are cheap to fix.
  // Afterwards they become wrong scores on real attempts.
  if (!hack.questions.length) {
    throw new ApiError(400, 'Cannot publish a test that has no questions');
  }

  const unanswerable = hack.questions.filter(
    (q) => !(q.options || []).some((o) => o.is_correct),
  );
  if (unanswerable.length) {
    throw new ApiError(
      400,
      `Cannot publish: ${unanswerable.length} question(s) have no correct option marked, so nobody can answer them correctly`,
    );
  }

  if (hack.passing_marks > hack.total_marks) {
    throw new ApiError(
      400,
      `Cannot publish: passing marks (${hack.passing_marks}) exceed the total marks available (${hack.total_marks})`,
    );
  }

  if (hack.access_type === 'paid' && !(hack.price > 0)) {
    throw new ApiError(400, 'Cannot publish a paid test with no price set');
  }

  hack.is_active = true;
  await hack.save();

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

/**
 * Pair incoming options with the ones already stored so their _id survives.
 *
 * Replacing the array wholesale made Mongoose mint a fresh ObjectId for every
 * option. Completed attempts snapshot the option _id the student selected, so
 * after any edit — even a typo fix — none of those ids resolved against the
 * question any more, and the next re-score wiped the student's result (and,
 * with negative marking on, actively deducted marks).
 *
 * Matching prefers an explicit _id, then identical text (which survives a
 * reorder), and finally position.
 */
const reconcileOptionIds = (incomingOptions = [], existingOptions = []) => {
  const byId = new Map(existingOptions.map((o) => [o._id.toString(), o]));
  const claimed = new Set();

  return incomingOptions.map((incoming, index) => {
    let match = null;

    if (incoming._id && byId.has(String(incoming._id))) {
      match = byId.get(String(incoming._id));
    }
    if (!match) {
      match = existingOptions.find(
        (o) => !claimed.has(o._id.toString()) && o.text === incoming.text,
      );
    }
    if (!match) {
      const positional = existingOptions[index];
      if (positional && !claimed.has(positional._id.toString())) {
        match = positional;
      }
    }
    if (match) claimed.add(match._id.toString());

    return {
      ...(match ? { _id: match._id } : {}),
      text: incoming.text,
      is_correct: incoming.is_correct,
    };
  });
};

export const updateQuestion = asyncHandler(async (req, res) => {
  const { id, questionId } = req.params;

  const hack = await Hack.findOne({ _id: id, isDeleted: false });
  if (!hack) throw new ApiError(404, 'Hack not found');

  const question = hack.questions.id(questionId);
  if (!question) throw new ApiError(404, 'Hack or Question not found');

  question.text = req.body.text;
  question.marks = req.body.marks;
  question.explanation = req.body.explanation;
  question.options = reconcileOptionIds(req.body.options, question.options);

  // save() (not findOneAndUpdate) so the totals hook recomputes total_marks.
  await hack.save();

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        hack.questions.id(questionId),
        'Question updated successfully',
      ),
    );
});

export const deleteQuestion = asyncHandler(async (req, res) => {
  const { id, questionId } = req.params;

  const hack = await Hack.findOne({ _id: id, isDeleted: false });
  if (!hack) throw new ApiError(404, 'Hack not found');

  const question = hack.questions.id(questionId);
  if (!question) throw new ApiError(404, 'Question not found');

  hack.questions.pull(questionId);
  await hack.save();

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
  // `>=` matches startTest: the instant the window closes, it is closed.
  if (hack.end_time && now >= new Date(hack.end_time)) return 'ended';
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

  const limit = Math.min(
    Math.max(parseInt(req.query.limit, 10) || 200, 1),
    500,
  );
  query = query.limit(limit);

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
  const isAdmin = req.user?.role === 'ADMIN';
  const filter = { _id: req.params.id, isDeleted: false };
  if (!isAdmin) filter.is_active = true;

  const hack = await Hack.findOne(filter).select(
    isAdmin ? '' : '-questions.options.is_correct -created_by',
  );

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

  // A live attempt is always resumable, whatever the one-attempt rule says.
  // Reporting "already attempted" for a student who is mid-test — which is
  // what happened on any page refresh — locked them out of their own paper
  // even though startTest would have handed the attempt straight back.
  const activeAttempt = await TestAttempt.findOne({
    user: req.user._id,
    hack: hack._id,
    status: 'IN_PROGRESS',
    expires_at: { $gt: new Date() },
  }).select('_id expires_at');

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
      const attemptCount = await TestAttempt.countDocuments({
        user: req.user._id,
        hack: hack._id,
      });

      if (activeAttempt) {
        hasAccess = true;
        reason = 'Resuming your in-progress attempt';
      } else if (attemptCount >= 1) {
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
        has_active_attempt: Boolean(activeAttempt),
        active_attempt_id: activeAttempt?._id || null,
        schedule_status: scheduleStatus,
        start_time: hack.start_time || null,
        end_time: hack.end_time || null,
        server_time: now.toISOString(),
      },
      'Access check completed',
    ),
  );
});
