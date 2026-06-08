import { Router } from 'express';
import {
  getCurrentUser,
  updateAccountDetails,
  updateUserAvatar,
  getAllUsers,
  getUserById,
  updateUserStatus,
  deleteUser,
} from '../controllers/user.controller.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import { authorizeRoles } from '../middlewares/role.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  updateAccountSchema,
  updateAvatarSchema,
  updateStatusSchema,
} from '../validators/user.validator.js';

const router = Router();

// Apply verifyJWT middleware to all routes in this file
router.use(verifyJWT);

// --- User Routes ---
router.route('/me').get(getCurrentUser);
router
  .route('/update-account')
  .patch(validate(updateAccountSchema), updateAccountDetails);
router.route('/avatar').patch(validate(updateAvatarSchema), updateUserAvatar);

// --- Admin Routes ---
// Apply authorizeRoles('ADMIN') middleware to all routes below
router.use(authorizeRoles('ADMIN'));

router.route('/').get(getAllUsers);
router.route('/:id').get(getUserById);
router
  .route('/:id/status')
  .patch(validate(updateStatusSchema), updateUserStatus);
router.route('/:id').delete(deleteUser);

export default router;
