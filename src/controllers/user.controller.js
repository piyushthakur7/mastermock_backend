import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { User } from '../models/user.model.js';
import { Enrollment } from '../models/enrollment.model.js';
import { TestAttempt } from '../models/testAttempt.model.js';
import { Notification } from '../models/notification.model.js';
import { Inquiry } from '../models/inquiry.model.js';
import { Purchase } from '../models/purchase.model.js';
import { logger } from '../utils/logger.js';

// @desc    Get current user profile
// @route   GET /api/v1/users/me
export const getCurrentUser = asyncHandler(async (req, res) => {
  // Enrollment lives in its own collection, not on the User document — the
  // frontend's course pages read user.enrolledCourses to decide whether to
  // show "Already Enrolled" vs a purchase/enroll button.
  const enrollments = await Enrollment.find({
    user: req.user._id,
    status: 'ACTIVE',
  }).select('course');

  const enrolledCourses = enrollments
    .filter((e) => e.course)
    .map((e) => e.course.toString());

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { ...req.user.toObject(), enrolledCourses },
        'User profile fetched successfully',
      ),
    );
});

// @desc    Update account details
// @route   PATCH /api/v1/users/update-account
export const updateAccountDetails = asyncHandler(async (req, res) => {
  const { full_name, phone_number } = req.body;

  if (full_name === undefined && phone_number === undefined) {
    throw new ApiError(
      400,
      'At least one field (full_name or phone_number) is required',
    );
  }

  const update = {};
  if (full_name !== undefined) update.full_name = full_name;
  // Blank clears the number rather than being ignored; the model's setter
  // maps it to undefined so the sparse unique index skips it.
  if (phone_number !== undefined) {
    update.phone_number = phone_number === '' ? undefined : phone_number;
  }

  // A duplicate phone number surfaces as 11000 and is mapped to a 409 by the
  // global error handler, rather than a 500 echoing the raw driver message.
  const updatedUser = await User.findByIdAndUpdate(
    req.user?._id,
    { $set: update },
    { new: true, runValidators: true },
  ).select('-password_hash -refresh_token');

  if (!updatedUser) throw new ApiError(404, 'User not found');

  return res
    .status(200)
    .json(
      new ApiResponse(200, updatedUser, 'Account details updated successfully'),
    );
});

// @desc    Update user avatar
// @route   PATCH /api/v1/users/avatar
export const updateUserAvatar = asyncHandler(async (req, res) => {
  const { profile_picture } = req.body;

  if (!profile_picture) {
    throw new ApiError(400, 'Profile picture URL is required');
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    { $set: { profile_picture } },
    { new: true },
  ).select('-password_hash -refresh_token');

  return res
    .status(200)
    .json(new ApiResponse(200, user, 'Avatar updated successfully'));
});

// --- ADMIN ROUTES ---

// @desc    Get all users (Admin only)
// @route   GET /api/v1/users
export const getAllUsers = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const skip = (page - 1) * limit;

  const filter = {};
  if (req.query.role) filter.role = String(req.query.role).toUpperCase();
  if (req.query.status) filter.status = String(req.query.status).toLowerCase();

  const [users, total] = await Promise.all([
    User.find(filter)
      .select('-password_hash -refresh_token')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    User.countDocuments(filter),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        data: users,
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit) || 1,
      },
      'Users fetched successfully',
    ),
  );
});

// @desc    Get user by ID (Admin only)
// @route   GET /api/v1/users/:id
export const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select(
    '-password_hash -refresh_token',
  );

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  return res
    .status(200)
    .json(new ApiResponse(200, user, 'User fetched successfully'));
});

// @desc    Update user status (Admin only)
// @route   PATCH /api/v1/users/:id/status
export const updateUserStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;

  // An admin suspending themselves locks them out with no way back in.
  if (
    String(req.params.id) === String(req.user._id) &&
    status === 'suspended'
  ) {
    throw new ApiError(400, 'You cannot suspend your own account');
  }

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { $set: { status } },
    { new: true, runValidators: true },
  ).select('-password_hash -refresh_token');

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  // Suspension must end the user's sessions, not just flag the account.
  if (status === 'suspended') {
    await User.updateOne({ _id: user._id }, { $unset: { refresh_token: 1 } });
  }

  return res
    .status(200)
    .json(new ApiResponse(200, user, 'User status updated successfully'));
});

// @desc    Delete user (Admin only)
// @route   DELETE /api/v1/users/:id
export const deleteUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (String(id) === String(req.user._id)) {
    throw new ApiError(400, 'You cannot delete your own account');
  }

  const user = await User.findById(id);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  // Deleting the User row on its own orphaned everything pointing at it: test
  // attempts kept their place on the leaderboard as an empty row, enrolments
  // stayed active, and inquiries hung off a student that no longer existed.
  const [attempts, enrolments, notifications, inquiries] = await Promise.all([
    TestAttempt.deleteMany({ user: id }),
    Enrollment.deleteMany({ user: id }),
    Notification.deleteMany({ user: id }),
    Inquiry.deleteMany({ student: id }),
  ]);

  // Purchases and Payments are financial records and are deliberately kept for
  // audit and reconciliation — but any remaining access is withdrawn.
  const purchases = await Purchase.updateMany(
    { user: id, status: 'ACTIVE' },
    { $set: { status: 'EXPIRED' } },
  );

  await User.findByIdAndDelete(id);

  logger.info(
    `User ${id} deleted by ${req.user._id}: removed ${attempts.deletedCount} attempts, ` +
      `${enrolments.deletedCount} enrolments, ${notifications.deletedCount} notifications, ` +
      `${inquiries.deletedCount} inquiries; expired ${purchases.modifiedCount} purchases`,
  );

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        deleted: {
          attempts: attempts.deletedCount,
          enrolments: enrolments.deletedCount,
          notifications: notifications.deletedCount,
          inquiries: inquiries.deletedCount,
        },
        purchases_expired: purchases.modifiedCount,
      },
      'User deleted successfully',
    ),
  );
});
