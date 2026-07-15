import { Router } from 'express';
import {
  startTest,
  saveAnswer,
  submitTest,
  getAttempt,
  evaluateTest,
  getMyAttempts,
  getAllAttempts,
} from '../controllers/testAttempt.controller.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import { authorizeRoles } from '../middlewares/role.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  startTestSchema,
  saveAnswerSchema,
} from '../validators/testAttempt.validator.js';

const router = Router();

// All routes require login
router.use(verifyJWT);

// Admin route — must be before /:attemptId to avoid param collision
router.get('/', authorizeRoles('ADMIN'), getAllAttempts);

// Student routes
router.get('/my', getMyAttempts);
router.post('/start', validate(startTestSchema), startTest);
router.put('/:attemptId/answer', validate(saveAnswerSchema), saveAnswer);
router.post('/:attemptId/submit', submitTest);
router.post('/:attemptId/evaluate', evaluateTest);
router.get('/:attemptId', getAttempt);

export default router;
