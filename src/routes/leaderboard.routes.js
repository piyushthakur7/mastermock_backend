import { Router } from 'express';
import {
  getMockTestLeaderboard,
  getMyRank,
} from '../controllers/leaderboard.controller.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(verifyJWT);
router.get('/:testId', getMockTestLeaderboard);
router.get('/:testId/my-rank', getMyRank);

export default router;
