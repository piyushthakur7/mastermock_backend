import { Router } from 'express';
import {
  createCourse,
  updateCourse,
  deleteCourse,
  publishCourse,
  unpublishCourse,
  getCourses,
  getCourseById,
  enrollCourse,
  getMyCourses,
} from '../controllers/course.controller.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import { authorizeRoles } from '../middlewares/role.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  createCourseSchema,
  updateCourseSchema,
} from '../validators/course.validator.js';

const router = Router();

// Apply verifyJWT to all routes
router.use(verifyJWT);

// Shared / Student routes
router.route('/').get(getCourses);
router.route('/my/enrolled').get(getMyCourses);
router.route('/:id').get(getCourseById);
router.route('/:id/enroll').post(enrollCourse);

// Admin routes
router
  .route('/')
  .post(authorizeRoles('ADMIN'), validate(createCourseSchema), createCourse);

router
  .route('/:id')
  .put(authorizeRoles('ADMIN'), validate(updateCourseSchema), updateCourse)
  .delete(authorizeRoles('ADMIN'), deleteCourse);

router.route('/:id/publish').patch(authorizeRoles('ADMIN'), publishCourse);
router.route('/:id/unpublish').patch(authorizeRoles('ADMIN'), unpublishCourse);

export default router;
