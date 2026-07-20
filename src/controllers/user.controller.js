import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { User } from '../models/user.model.js';
import { Enrollment } from '../models/enrollment.model.js';

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
  const enrolledCourses = enrollments.map((e) => e.course.toString());

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

  if (!full_name && !phone_number) {
    throw new ApiError(
      400,
      'At least one field (full_name or phone_number) is required',
    );
  }

  const updatedUser = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        ...(full_name && { full_name }),
        ...(phone_number && { phone_number }),
      },
    },
    { new: true, runValidators: true },
  ).select('-password_hash -refresh_token');

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
    {
      $set: {
        profile_picture,
      },
    },
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
  const users = await User.find().select('-password_hash -refresh_token');

  return res
    .status(200)
    .json(new ApiResponse(200, users, 'Users fetched successfully'));
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

  const user = await User.findByIdAndUpdate(
    req.params.id,
    {
      $set: { status },
    },
    { new: true, runValidators: true },
  ).select('-password_hash -refresh_token');

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  return res
    .status(200)
    .json(new ApiResponse(200, user, 'User status updated successfully'));
});

// @desc    Delete user (Admin only)
// @route   DELETE /api/v1/users/:id
export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndDelete(req.params.id);

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'User deleted successfully'));
});
