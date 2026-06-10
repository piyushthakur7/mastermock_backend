import { Router } from 'express';
import {
  createCategory,
  updateCategory,
  deleteCategory,
  getCategories,
  getCategoryById,
} from '../controllers/category.controller.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import { authorizeRoles } from '../middlewares/role.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  createCategorySchema,
  updateCategorySchema,
} from '../validators/category.validator.js';

const router = Router();

// Public routes (Student/Anyone can view)
router.route('/').get(getCategories);
router.route('/:id').get(getCategoryById);

// Admin routes
router.use(verifyJWT);
router.use(authorizeRoles('ADMIN'));

router.route('/').post(validate(createCategorySchema), createCategory);

router
  .route('/:id')
  .put(validate(updateCategorySchema), updateCategory)
  .delete(deleteCategory);

export default router;
