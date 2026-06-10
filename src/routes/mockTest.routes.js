import { Router } from 'express';
import {
  createMockTest,
  updateMockTest,
  deleteMockTest,
  publishMockTest,
  unpublishMockTest,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  bulkUploadQuestions,
  getMockTests,
  getMockTestById,
} from '../controllers/mockTest.controller.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import { authorizeRoles } from '../middlewares/role.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  createMockTestSchema,
  updateMockTestSchema,
  questionSchema,
  bulkUploadQuestionsSchema,
} from '../validators/mockTest.validator.js';

const router = Router();

router.use(verifyJWT);

router.route('/').get(getMockTests);
router.route('/:id').get(getMockTestById);

router.use(authorizeRoles('ADMIN'));

router.route('/').post(validate(createMockTestSchema), createMockTest);

router
  .route('/:id')
  .put(validate(updateMockTestSchema), updateMockTest)
  .delete(deleteMockTest);

router.route('/:id/publish').patch(publishMockTest);
router.route('/:id/unpublish').patch(unpublishMockTest);

router.route('/:id/questions').post(validate(questionSchema), addQuestion);

router
  .route('/:id/questions/bulk')
  .post(validate(bulkUploadQuestionsSchema), bulkUploadQuestions);

router
  .route('/:id/questions/:questionId')
  .put(validate(questionSchema), updateQuestion)
  .delete(deleteQuestion);

export default router;
