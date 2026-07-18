import jwt from 'jsonwebtoken';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { User } from '../models/user.model.js';
import { env } from '../config/env.js';

export const verifyJWT = asyncHandler(async (req, res, next) => {
  try {
    const token =
      req.cookies?.accessToken ||
      req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      throw new ApiError(401, 'Unauthorized request: No token provided');
    }

    const decodedToken = jwt.verify(token, env.ACCESS_TOKEN_SECRET);

    const user = await User.findById(decodedToken?._id).select(
      '-password_hash -refresh_token',
    );

    if (!user) {
      throw new ApiError(401, 'Invalid Access Token: User not found');
    }

    if (user.status === 'suspended') {
      throw new ApiError(403, 'Account is suspended');
    }

    req.user = user;
    next();
  } catch (error) {
    // Only token problems are 401s. Blanket-rewrapping also downgraded the
    // suspended-account 403 and disguised database outages as auth failures.
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, error?.message || 'Invalid access token');
  }
});

export const optionalVerifyJWT = asyncHandler(async (req, res, next) => {
  try {
    const token =
      req.cookies?.accessToken ||
      req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return next();
    }

    const decodedToken = jwt.verify(token, env.ACCESS_TOKEN_SECRET);
    const user = await User.findById(decodedToken?._id).select(
      '-password_hash -refresh_token',
    );

    if (user && user.status !== 'suspended') {
      req.user = user;
    }
    next();
  } catch (error) {
    next();
  }
});
