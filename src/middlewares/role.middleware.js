import { ApiError } from '../utils/ApiError.js';

export const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    const userRole = req.user?.role?.toUpperCase();
    const upperAllowedRoles = allowedRoles.map((role) => role.toUpperCase());

    if (!req.user || !upperAllowedRoles.includes(userRole)) {
      throw new ApiError(
        403,
        `Role ${req.user?.role} is not allowed to access this resource`,
      );
    }
    next();
  };
};
