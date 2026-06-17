import { Router } from 'express';
import {
  uploadResource,
  deleteResource,
  getCourseResources,
  downloadResource,
  serveResource,
} from '../controllers/resource.controller.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import { authorizeRoles } from '../middlewares/role.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { upload } from '../middlewares/upload.middleware.js';
import { createResourceSchema } from '../validators/resource.validator.js';

const router = Router();

// Publicly accessible route (uses JWT in query params instead of Bearer token)
router.route('/serve').get(serveResource);

// Apply verifyJWT to all other routes
router.use(verifyJWT);

// Shared / Student routes
router.route('/course/:courseId').get(getCourseResources);
router.route('/:id/download').get(downloadResource);

// Admin routes
router.use(authorizeRoles('ADMIN'));

// We need a custom middleware flow to use multer first, then parse/validate the body
router
  .route('/')
  .post(upload.single('file'), validate(createResourceSchema), uploadResource);

router.route('/:id').delete(deleteResource);

export default router;
