import { Router } from 'express';
import {
  startTest,
  saveAnswer,
  submitTest,
  getAttempt,
  evaluateTest,
} from '../controllers/testAttempt.controller.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  startTestSchema,
  saveAnswerSchema,
} from '../validators/testAttempt.validator.js';

const router = Router();

// All routes require student login
router.use(verifyJWT);

router.post('/start', validate(startTestSchema), startTest);
router.put('/:attemptId/answer', validate(saveAnswerSchema), saveAnswer);
router.post('/:attemptId/submit', submitTest);
router.post('/:attemptId/evaluate', evaluateTest);
router.get('/:attemptId', getAttempt);

export default router;
