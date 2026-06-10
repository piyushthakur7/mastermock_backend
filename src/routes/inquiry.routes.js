import { Router } from 'express';
import { Inquiry } from '../models/inquiry.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import { authorizeRoles } from '../middlewares/role.middleware.js';

const router = Router();
router.use(verifyJWT);

// Student
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const inquiry = await Inquiry.create({
      student: req.user._id,
      subject: req.body.subject,
      message: req.body.message,
    });
    res.json(new ApiResponse(201, inquiry, 'Inquiry submitted'));
  }),
);

router.get(
  '/my',
  asyncHandler(async (req, res) => {
    const inquiries = await Inquiry.find({ student: req.user._id }).sort({
      createdAt: -1,
    });
    res.json(new ApiResponse(200, inquiries, 'My inquiries'));
  }),
);

// Admin
router.get(
  '/',
  authorizeRoles('ADMIN'),
  asyncHandler(async (req, res) => {
    const inquiries = await Inquiry.find()
      .sort({ createdAt: -1 })
      .populate('student', 'name email');
    res.json(new ApiResponse(200, inquiries, 'All inquiries'));
  }),
);

router.patch(
  '/:id/reply',
  authorizeRoles('ADMIN'),
  asyncHandler(async (req, res) => {
    const inquiry = await Inquiry.findByIdAndUpdate(
      req.params.id,
      {
        admin_reply: req.body.reply,
        status: 'RESOLVED',
        replied_by: req.user._id,
        replied_at: new Date(),
      },
      { new: true },
    );
    res.json(new ApiResponse(200, inquiry, 'Inquiry replied'));
  }),
);

export default router;
