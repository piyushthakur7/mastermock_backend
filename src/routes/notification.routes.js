import { Router } from 'express';
import { Notification } from '../models/notification.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';

const router = Router();
router.use(verifyJWT);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const notifications = await Notification.find({
      recipient: req.user._id,
    }).sort({ createdAt: -1 });
    res.json(new ApiResponse(200, notifications, 'Notifications fetched'));
  }),
);

router.patch(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id },
      { is_read: true },
      { new: true },
    );
    res.json(new ApiResponse(200, notification, 'Notification marked as read'));
  }),
);

export default router;
