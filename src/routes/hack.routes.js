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
import {
  verifyJWT,
  optionalVerifyJWT,
} from '../middlewares/auth.middleware.js';
import { authorizeRoles } from '../middlewares/role.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  createHackSchema,
  updateHackSchema,
  questionSchema,
  bulkUploadQuestionsSchema,
} from '../validators/hack.validator.js';

const router = Router();

// Student routes (public or optional auth)
router.route('/').get(optionalVerifyJWT, getHacks);
router.route('/my/purchased').get(verifyJWT, getMyPurchasedHacks);
router.route('/:id').get(optionalVerifyJWT, getHackById);
router.route('/:id/check-access').get(verifyJWT, checkAccess);

// Admin routes
router.use(verifyJWT, authorizeRoles('ADMIN'));

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
