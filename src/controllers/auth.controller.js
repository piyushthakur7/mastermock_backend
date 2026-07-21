import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { User } from '../models/user.model.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { clearRateLimitKey } from '../middlewares/rateLimiter.middleware.js';

const MAX_LOGIN_ATTEMPTS = 8;
const LOCK_DURATION_MS = 15 * 60 * 1000;

/**
 * A real bcrypt hash to compare against when no account matches.
 *
 * Returning 401 immediately for an unknown address while spending ~100ms on
 * bcrypt for a known one turned login into a user-enumeration oracle — the
 * careful anti-enumeration work on admin-login and forgot-password was
 * undone by the timing of this route.
 */
const dummyHashPromise = bcrypt.hash('unused-placeholder-password', 10);

const equaliseTiming = async (password) => {
  try {
    await bcrypt.compare(String(password || ''), await dummyHashPromise);
  } catch {
    /* timing padding only */
  }
};

/** '15m' | '1d' | '10d' | '3600' -> milliseconds */
const expiryToMs = (value, fallbackMs) => {
  if (!value) return fallbackMs;
  const match = String(value).match(/^(\d+)\s*([smhd])?$/i);
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  const unit = (match[2] || 's').toLowerCase();
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return amount * (multipliers[unit] || 1000);
};

const generateAccessAndRefreshTokens = async (userId) => {
  const user = await User.findById(userId);
  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();

  user.refresh_token = refreshToken;
  await user.save({ validateBeforeSave: false });

  return { accessToken, refreshToken };
};

const baseCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/',
};

// Without maxAge these were session cookies discarded on browser close, while
// the JWTs inside them stayed valid for days — so "remember me" silently
// never worked. Match each cookie to the lifetime of the token it carries.
const accessCookieOptions = {
  ...baseCookieOptions,
  maxAge: expiryToMs(env.ACCESS_TOKEN_EXPIRY, 86400000),
};
const refreshCookieOptions = {
  ...baseCookieOptions,
  maxAge: expiryToMs(env.REFRESH_TOKEN_EXPIRY, 864000000),
};

const isLocked = (user) =>
  Boolean(user.lockUntil && user.lockUntil.getTime() > Date.now());

const registerFailedLogin = async (user) => {
  const attempts = (user.loginAttempts || 0) + 1;

  if (attempts >= MAX_LOGIN_ATTEMPTS) {
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          loginAttempts: 0,
          lockUntil: new Date(Date.now() + LOCK_DURATION_MS),
        },
      },
    );
    logger.warn(
      `Account temporarily locked after ${MAX_LOGIN_ATTEMPTS} failed logins: user=${user._id}`,
    );
    return;
  }

  await User.updateOne(
    { _id: user._id },
    { $set: { loginAttempts: attempts } },
  );
};

const clearLoginAttempts = async (user) => {
  if (!user.loginAttempts && !user.lockUntil) return;
  await User.updateOne(
    { _id: user._id },
    { $set: { loginAttempts: 0 }, $unset: { lockUntil: 1 } },
  );
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
    // There is no email-verification flow yet, and nothing anywhere checks for
    // 'unverified' — every account sat in that state forever while having full
    // access, which made the status enum misleading. When verification lands,
    // set this back to 'unverified' and add the verify endpoint.
    status: 'active',
  });

  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    user._id,
  );

  const createdUser = await User.findById(user._id).select(
    '-password_hash -refresh_token',
  );

  return res
    .status(201)
    .cookie('accessToken', accessToken, accessCookieOptions)
    .cookie('refreshToken', refreshToken, refreshCookieOptions)
    .json(
      new ApiResponse(
        201,
        { user: createdUser, accessToken, refreshToken },
        'User registered successfully',
      ),
    );
});

// @desc    Login a user
// @route   POST /api/v1/auth/login
export const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select('+password_hash');

  if (!user) {
    await equaliseTiming(password);
    throw new ApiError(401, 'Invalid credentials');
  }

  if (isLocked(user)) {
    throw new ApiError(
      429,
      'Too many failed login attempts. Please try again in a few minutes.',
    );
  }

  const isPasswordValid = await user.isPasswordCorrect(password);

  if (!isPasswordValid) {
    await registerFailedLogin(user);
    throw new ApiError(401, 'Invalid credentials');
  }

  await clearLoginAttempts(user);
  // A user who mistyped a few times then got in should not stay penalised.
  await clearRateLimitKey(req, 'login');

  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    user._id,
  );

  const loggedInUser = await User.findById(user._id).select(
    '-password_hash -refresh_token',
  );

  return res
    .status(200)
    .cookie('accessToken', accessToken, accessCookieOptions)
    .cookie('refreshToken', refreshToken, refreshCookieOptions)
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
    await equaliseTiming(password);
    throw new ApiError(401, 'Invalid credentials');
  }

  if (isLocked(user)) {
    throw new ApiError(
      429,
      'Too many failed login attempts. Please try again in a few minutes.',
    );
  }

  // Password first, role second. Checking the role first let anyone probe this
  // endpoint to find out which addresses are admin accounts without ever
  // knowing a password.
  const isPasswordValid = await user.isPasswordCorrect(password);

  if (!isPasswordValid) {
    await registerFailedLogin(user);
    throw new ApiError(401, 'Invalid credentials');
  }

  // Enforce Admin Role
  if (user.role !== 'ADMIN') {
    throw new ApiError(403, 'Access denied. Only admins can use this login.');
  }

  await clearLoginAttempts(user);
  await clearRateLimitKey(req, 'admin-login');

  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    user._id,
  );

  const loggedInUser = await User.findById(user._id).select(
    '-password_hash -refresh_token',
  );

  return res
    .status(200)
    .cookie('accessToken', accessToken, accessCookieOptions)
    .cookie('refreshToken', refreshToken, refreshCookieOptions)
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
    .clearCookie('accessToken', baseCookieOptions)
    .clearCookie('refreshToken', baseCookieOptions)
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

  let decodedToken;
  try {
    decodedToken = jwt.verify(incomingRefreshToken, env.REFRESH_TOKEN_SECRET);
  } catch {
    throw new ApiError(401, 'Invalid refresh token. Please login again.');
  }

  const user = await User.findById(decodedToken?._id);

  if (!user || incomingRefreshToken !== user.refresh_token) {
    logger.warn(
      `Refresh token mismatch for user: ${user?.email || decodedToken?._id}, IP: ${req.ip || 'unknown'}`,
    );
    throw new ApiError(401, 'Invalid refresh token. Please login again.');
  }

  if (user.status === 'suspended') {
    throw new ApiError(403, 'Account is suspended');
  }

  const accessToken = user.generateAccessToken();

  return res
    .status(200)
    .cookie('accessToken', accessToken, accessCookieOptions)
    .json(
      new ApiResponse(
        200,
        { accessToken, refreshToken: incomingRefreshToken },
        'Access token refreshed',
      ),
    );
});

// @desc    Change Current Password
// @route   POST /api/v1/auth/change-password
export const changeCurrentPassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password_hash');

  if (!user) throw new ApiError(404, 'User not found');

  const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);
  if (!isPasswordCorrect) {
    throw new ApiError(400, 'Invalid old password');
  }

  if (oldPassword === newPassword) {
    throw new ApiError(
      400,
      'The new password must be different from the current one',
    );
  }

  user.password_hash = newPassword;
  user.refresh_token = undefined;
  await user.save({ validateBeforeSave: false });

  // Changing a password must end other sessions, not just clear the stored
  // refresh token on this document.
  return res
    .status(200)
    .clearCookie('accessToken', baseCookieOptions)
    .clearCookie('refreshToken', baseCookieOptions)
    .json(
      new ApiResponse(
        200,
        {},
        'Password changed successfully. Please log in again.',
      ),
    );
});

// @desc    Forgot Password
// @route   POST /api/v1/auth/forgot-password
export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });

  // Always answer the same way. A 404 for unknown addresses turned this
  // endpoint into a free "is this person registered?" oracle.
  if (user) {
    const resetToken = crypto.randomBytes(32).toString('hex');

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
  } else {
    logger.info(`Password reset requested for unregistered email: ${email}`);
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        {},
        'If an account exists for that email, a password reset link has been sent',
      ),
    );
});

// @desc    Reset Password
// @route   POST /api/v1/auth/reset-password/:token
export const resetPassword = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  if (!token || typeof token !== 'string') {
    throw new ApiError(400, 'Invalid or expired reset token');
  }

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
  // A successful reset also clears any brute-force lock.
  user.loginAttempts = 0;
  user.lockUntil = undefined;
  await user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .clearCookie('accessToken', baseCookieOptions)
    .clearCookie('refreshToken', baseCookieOptions)
    .json(new ApiResponse(200, {}, 'Password reset successfully'));
});
