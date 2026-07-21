import { Router } from 'express';
import { Inquiry } from '../models/inquiry.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import { authorizeRoles } from '../middlewares/role.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  createInquirySchema,
  replyInquirySchema,
} from '../validators/inquiry.validator.js';

const router = Router();
router.use(verifyJWT);

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

// --- Student ---

// These routes had no validation middleware at all, so a missing subject or
// message reached Mongoose and came back as a 500 carrying the raw
// "Inquiry validation failed: ..." string.
router.post(
  '/',
  validate(createInquirySchema),
  asyncHandler(async (req, res) => {
    const inquiry = await Inquiry.create({
      student: req.user._id,
      subject: req.body.subject,
      message: req.body.message,
    });
    // Status code and body now agree — this used to send HTTP 200 with a body
    // claiming 201.
    res.status(201).json(new ApiResponse(201, inquiry, 'Inquiry submitted'));
  }),
);

router.get(
  '/my',
  asyncHandler(async (req, res) => {
    const inquiries = await Inquiry.find({ student: req.user._id })
      .sort({ createdAt: -1 })
      .populate('replies.author', 'full_name role');
    res.json(new ApiResponse(200, inquiries, 'My inquiries'));
  }),
);

// --- Replies (both roles) ---

// Admin replies APPEND to the thread, and a student can answer back. The model
// only ever had a single `admin_reply` string, so a second reply overwrote the
// first and holding a conversation was impossible.
router.post(
  '/:id/reply',
  validate(replyInquirySchema),
  asyncHandler(async (req, res) => {
    if (!OBJECT_ID.test(req.params.id)) {
      throw new ApiError(400, 'Invalid inquiry id');
    }

    const isAdmin = req.user.role === 'ADMIN';

    // A student may only reply within their own thread.
    const inquiry = await Inquiry.findOne(
      isAdmin
        ? { _id: req.params.id }
        : { _id: req.params.id, student: req.user._id },
    );

    // findByIdAndUpdate previously returned null for an unknown id and the
    // route answered 200 with data: null.
    if (!inquiry) throw new ApiError(404, 'Inquiry not found');

    if (inquiry.status === 'CLOSED' && !isAdmin) {
      throw new ApiError(400, 'This inquiry is closed');
    }

    inquiry.replies.push({
      message: req.body.message,
      author: req.user._id,
      author_role: isAdmin ? 'ADMIN' : 'STUDENT',
      created_at: new Date(),
    });

    if (isAdmin) {
      inquiry.status = req.body.status || 'RESOLVED';
    } else if (inquiry.status === 'RESOLVED') {
      // The student came back with more — reopen it.
      inquiry.status = 'IN_PROGRESS';
    }

    await inquiry.save();
    await inquiry.populate('replies.author', 'full_name role');

    res.json(new ApiResponse(200, inquiry, 'Reply added'));
  }),
);

// --- Admin ---

router.get(
  '/',
  authorizeRoles('ADMIN'),
  asyncHandler(async (req, res) => {
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 50, 1),
      200,
    );
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

    const filter = {};
    if (req.query.status) {
      filter.status = String(req.query.status).toUpperCase();
    }

    const [inquiries, total] = await Promise.all([
      Inquiry.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('student', 'full_name email')
        .populate('replies.author', 'full_name role'),
      Inquiry.countDocuments(filter),
    ]);

    res.json(
      new ApiResponse(
        200,
        {
          data: inquiries,
          total,
          page,
          limit,
          total_pages: Math.ceil(total / limit) || 1,
        },
        'All inquiries',
      ),
    );
  }),
);

router.patch(
  '/:id/status',
  authorizeRoles('ADMIN'),
  asyncHandler(async (req, res) => {
    const status = String(req.body?.status || '').toUpperCase();
    if (!['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(status)) {
      throw new ApiError(400, 'Invalid status');
    }

    const inquiry = await Inquiry.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true },
    );
    if (!inquiry) throw new ApiError(404, 'Inquiry not found');

    res.json(new ApiResponse(200, inquiry, 'Inquiry status updated'));
  }),
);

export default router;
