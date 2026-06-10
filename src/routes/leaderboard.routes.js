import { Router } from 'express';
import { getMockTestLeaderboard } from '../controllers/leaderboard.controller.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(verifyJWT);
router.get('/:testId', getMockTestLeaderboard);

export default router;
