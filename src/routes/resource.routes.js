import { Router } from 'express';
import {
  uploadResource,
  deleteResource,
  getAllResources,
  getCourseResources,
  downloadResource,
  getStorageStatus,
} from '../controllers/resource.controller.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import { authorizeRoles } from '../middlewares/role.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { upload } from '../middlewares/upload.middleware.js';
import { createResourceSchema } from '../validators/resource.validator.js';

const router = Router();

router.use(verifyJWT);

// Student routes. Paid resources are gated inside downloadResource.
router.route('/').get(getAllResources);
router.route('/course/:courseId').get(getCourseResources);
router.route('/:id/download').get(downloadResource);

// Admin routes
// Registered before the `/:id` matcher so the literal path is not swallowed.
router.route('/storage-status').get(authorizeRoles('ADMIN'), getStorageStatus);

router.use(authorizeRoles('ADMIN'));

// Multer runs first so the multipart body is parsed before validation.
router
  .route('/')
  .post(upload.single('file'), validate(createResourceSchema), uploadResource);

router.route('/:id').delete(deleteResource);

export default router;
