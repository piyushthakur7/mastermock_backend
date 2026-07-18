import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { User } from '../models/user.model.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

import { clearRateLimitKey } from '../middlewares/rateLimiter.middleware.js';

const generateAccessAndRefreshTokens = async (userId) => {
  const user = await User.findById(userId);
  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();

  user.refresh_token = refreshToken;
  await user.save({ validateBeforeSave: false });

  return { accessToken, refreshToken };
};

const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
};

// @desc    Register a user
// @route   POST /api/v1/auth/register
export const registerUser = asyncHandler(async (req, res) => {
  const { full_name, email, password, phone_number } = req.body;

  const existedUser = await User.findOne({ email });
  if (existedUser) {
    throw new ApiError(409, 'User with this email already exists');
  }

  const user = await User.create({
    full_name,
    email,
    password_hash: password,
    phone_number,
  });

  const createdUser = await User.findById(user._id).select(
    '-password_hash -refresh_token',
  );

  return res
    .status(201)
    .json(new ApiResponse(201, createdUser, 'User registered successfully'));
});

// @desc    Login a user
// @route   POST /api/v1/auth/login
export const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select('+password_hash');

  if (!user) {
    throw new ApiError(401, 'Invalid credentials');
  }

  const isPasswordValid = await user.isPasswordCorrect(password);

  if (!isPasswordValid) {
    throw new ApiError(401, 'Invalid credentials');
  }

  // Successful login — reset the brute-force counter for this IP + email.
  await clearRateLimitKey(req, 'login');

  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    user._id,
  );

  const loggedInUser = await User.findById(user._id).select(
    '-password_hash -refresh_token',
  );

  return res
    .status(200)
    .cookie('accessToken', accessToken, cookieOptions)
    .cookie('refreshToken', refreshToken, cookieOptions)
    .json(
      new ApiResponse(
        200,
        { user: loggedInUser, accessToken, refreshToken },
        'User logged in successfully',
      ),
    );
});

// @desc    Login an Admin
// @route   POST /api/v1/auth/admin-login
export const adminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select('+password_hash');

  if (!user) {
    throw new ApiError(401, 'Invalid credentials');
  }

  // Enforce Admin Role
  if (user.role !== 'ADMIN') {
    throw new ApiError(403, 'Access denied. Only admins can use this login.');
  }

  const isPasswordValid = await user.isPasswordCorrect(password);

  if (!isPasswordValid) {
    throw new ApiError(401, 'Invalid credentials');
  }

  // Successful login — reset the brute-force counter for this IP + email.
  await clearRateLimitKey(req, 'admin-login');

  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    user._id,
  );

  const loggedInUser = await User.findById(user._id).select(
    '-password_hash -refresh_token',
  );

  return res
    .status(200)
    .cookie('accessToken', accessToken, cookieOptions)
    .cookie('refreshToken', refreshToken, cookieOptions)
    .json(
      new ApiResponse(
        200,
        { user: loggedInUser, accessToken, refreshToken },
        'Admin logged in successfully',
      ),
    );
});

// @desc    Logout user
// @route   POST /api/v1/auth/logout
export const logoutUser = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(
    req.user._id,
    { $unset: { refresh_token: 1 } },
    { new: true },
  );

  return res
    .status(200)
    .clearCookie('accessToken', cookieOptions)
    .clearCookie('refreshToken', cookieOptions)
    .json(new ApiResponse(200, {}, 'User logged out successfully'));
});

// @desc    Refresh Access Token
// @route   POST /api/v1/auth/refresh-token
//
// The refresh token is NOT rotated here. Rotation-per-refresh caused a race:
// rapid navigation fires several 401'd requests at once, each hitting this
// endpoint concurrently — the first rotates the token and the rest arrive
// with the now-stale one, which used to be treated as token theft and force
// a logout. The token stays valid until it expires or the user logs out.
export const refreshAccessToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken =
    req.cookies.refreshToken || req.body.refreshToken;

  if (!incomingRefreshToken) {
    throw new ApiError(401, 'Unauthorized request');
  }

  try {
    const decodedToken = jwt.verify(
      incomingRefreshToken,
      env.REFRESH_TOKEN_SECRET,
    );
    const user = await User.findById(decodedToken?._id);

    if (!user || incomingRefreshToken !== user.refresh_token) {
      logger.warn(
        `Refresh token mismatch for user: ${user?.email || decodedToken?._id}, IP: ${req.ip || 'unknown'}`,
      );
      throw new ApiError(401, 'Invalid refresh token. Please login again.');
    }

    const accessToken = user.generateAccessToken();

    return res
      .status(200)
      .cookie('accessToken', accessToken, cookieOptions)
      .json(
        new ApiResponse(
          200,
          { accessToken, refreshToken: incomingRefreshToken },
          'Access token refreshed',
        ),
      );
  } catch (error) {
    throw new ApiError(401, error?.message || 'Invalid refresh token');
  }
});

// @desc    Change Current Password
// @route   POST /api/v1/auth/change-password
export const changeCurrentPassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password_hash');

  const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);
  if (!isPasswordCorrect) {
    throw new ApiError(400, 'Invalid old password');
  }

  user.password_hash = newPassword;
  user.refresh_token = undefined;
  await user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'Password changed successfully'));
});

// @desc    Forgot Password
// @route   POST /api/v1/auth/forgot-password
export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });

  if (!user) {
    throw new ApiError(404, 'User with this email does not exist');
  }

  const resetToken = crypto.randomBytes(20).toString('hex');

  // Hash token to save in DB securely
  user.resetPasswordToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
  user.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 mins

  await user.save({ validateBeforeSave: false });

  const resetUrl = `${env.FRONTEND_URL}/reset-password/${resetToken}`;

  // TODO: Send Email (Mocking for now)
  logger.info(`[MOCK EMAIL SEND] To: ${user.email} | Reset URL: ${resetUrl}`);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        {},
        'Password reset token generated and sent to email',
      ),
    );
});

// @desc    Reset Password
// @route   POST /api/v1/auth/reset-password/:token
export const resetPassword = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpire: { $gt: Date.now() },
  });

  if (!user) {
    throw new ApiError(400, 'Invalid or expired reset token');
  }

  user.password_hash = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  user.refresh_token = undefined;
  await user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, 'Password reset successfully'));
});
