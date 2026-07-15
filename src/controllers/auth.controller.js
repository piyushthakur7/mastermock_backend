import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { User } from '../models/user.model.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

import { redis } from '../utils/redis.js';

const generateAccessAndRefreshTokens = async (
  userId,
  oldRefreshToken = null,
) => {
  const user = await User.findById(userId);
  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();

  // Token Rotation: Overwrite old refresh token
  user.refresh_token = refreshToken;
  await user.save({ validateBeforeSave: false });

  if (oldRefreshToken && redis) {
    const payload = JSON.stringify({ accessToken, refreshToken });
    await redis.set(`rotated_token:${oldRefreshToken}`, payload, 'EX', 30);
  }

  return { accessToken, refreshToken };
};

const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict',
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

    if (!user) {
      throw new ApiError(401, 'Invalid refresh token');
    }

    // Detect token reuse
    if (incomingRefreshToken !== user?.refresh_token) {
      if (redis) {
        const cachedPayload = await redis.get(
          `rotated_token:${incomingRefreshToken}`,
        );
        if (cachedPayload) {
          logger.info(
            `Concurrent refresh detected for user: ${user.email}. Using grace period tokens.`,
          );
          const { accessToken, refreshToken } = JSON.parse(cachedPayload);
          return res
            .status(200)
            .cookie('accessToken', accessToken, cookieOptions)
            .cookie('refreshToken', refreshToken, cookieOptions)
            .json(
              new ApiResponse(
                200,
                { accessToken, refreshToken },
                'Access token refreshed (concurrent)',
              ),
            );
        }
      }

      // Security Breach: Token was reused! Clear all tokens.
      await User.findByIdAndUpdate(user._id, { $unset: { refresh_token: 1 } });
      logger.warn(`Refresh Token Reuse Detected for user: ${user.email}`);
      throw new ApiError(
        401,
        'Refresh token is expired or used. Please login again.',
      );
    }

    const { accessToken, refreshToken: newRefreshToken } =
      await generateAccessAndRefreshTokens(user._id, incomingRefreshToken);

    return res
      .status(200)
      .cookie('accessToken', accessToken, cookieOptions)
      .cookie('refreshToken', newRefreshToken, cookieOptions)
      .json(
        new ApiResponse(
          200,
          { accessToken, refreshToken: newRefreshToken },
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
