import { Router } from 'express';
import { Notification } from '../models/notification.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';

const router = Router();
router.use(verifyJWT);

// The owner field on the schema is `user`. These queries filtered on
// `recipient`, which does not exist on the model — and because Mongoose
// defaults strictQuery to false, that filter reached MongoDB verbatim and
// matched nothing, so every user's notification list was silently empty
// forever. (On a stricter Mongoose the same code drops the filter instead and
// returns *everyone's* notifications, so this was one upgrade away from
// becoming a data leak.)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 50, 1),
      200,
    );

    const notifications = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(limit);

    res.json(new ApiResponse(200, notifications, 'Notifications fetched'));
  }),
);

router.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const count = await Notification.countDocuments({
      user: req.user._id,
      is_read: false,
    });
    res.json(new ApiResponse(200, { count }, 'Unread count fetched'));
  }),
);

router.patch(
  '/:id/read',
  asyncHandler(async (req, res) => {
    if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id))) {
      throw new ApiError(400, 'Invalid notification id');
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { $set: { is_read: true } },
      { new: true },
    );

    // Previously returned 200 with data: null for an id that did not exist or
    // belonged to someone else.
    if (!notification) throw new ApiError(404, 'Notification not found');

    res.json(new ApiResponse(200, notification, 'Notification marked as read'));
  }),
);

router.patch(
  '/read-all',
  asyncHandler(async (req, res) => {
    const result = await Notification.updateMany(
      { user: req.user._id, is_read: false },
      { $set: { is_read: true } },
    );
    res.json(
      new ApiResponse(
        200,
        { updated: result.modifiedCount || 0 },
        'All notifications marked as read',
      ),
    );
  }),
);

export default router;
