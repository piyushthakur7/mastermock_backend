import { Router } from 'express';
import {
  getStudentDashboard,
  getAdminDashboard,
} from '../controllers/dashboard.controller.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';
import { authorizeRoles } from '../middlewares/role.middleware.js';

const router = Router();
router.use(verifyJWT);

router.get('/student', getStudentDashboard);
router.get('/admin', authorizeRoles('ADMIN'), getAdminDashboard);

export default router;
