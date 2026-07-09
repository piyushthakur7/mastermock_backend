import { Router } from 'express';
import {
  createHack,
  updateHack,
  deleteHack,
  publishHack,
  unpublishHack,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  bulkUploadQuestions,
  getHacks,
  getHackById,
  getMyPurchasedHacks,
  checkAccess,
} from '../controllers/hack.controller.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import { authorizeRoles } from '../middlewares/role.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  createHackSchema,
  updateHackSchema,
  questionSchema,
  bulkUploadQuestionsSchema,
} from '../validators/hack.validator.js';

const router = Router();

router.use(verifyJWT);

// Student routes (specific paths BEFORE parameterized /:id)
router.route('/').get(getHacks);
router.route('/my/purchased').get(getMyPurchasedHacks);
router.route('/:id').get(getHackById);
router.route('/:id/check-access').get(checkAccess);

// Admin routes
router.use(authorizeRoles('ADMIN'));

router.route('/').post(validate(createHackSchema), createHack);

router
  .route('/:id')
  .put(validate(updateHackSchema), updateHack)
  .delete(deleteHack);

router.route('/:id/publish').patch(publishHack);
router.route('/:id/unpublish').patch(unpublishHack);

router.route('/:id/questions').post(validate(questionSchema), addQuestion);

router
  .route('/:id/questions/bulk')
  .post(validate(bulkUploadQuestionsSchema), bulkUploadQuestions);

router
  .route('/:id/questions/:questionId')
  .put(validate(questionSchema), updateQuestion)
  .delete(deleteQuestion);

export default router;
