import { Router } from 'express';
import {
  getHackLeaderboard,
  getMyRank,
} from '../controllers/leaderboard.controller.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(verifyJWT);
router.get('/:testId', getHackLeaderboard);
router.get('/:testId/my-rank', getMyRank);

export default router;
