import { Router } from 'express';
import { healthcheck } from '../controllers/healthcheck.controller.js';

const router = Router();

/**
 * @swagger
 * /healthcheck:
 *   get:
 *     summary: Check if the API is running
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Healthcheck passed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 statusCode:
 *                   type: integer
 *                   example: 200
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       example: ok
 *                 message:
 *                   type: string
 *                   example: Healthcheck passed
 *                 success:
 *                   type: boolean
 *                   example: true
 */
router.route('/').get(healthcheck);

export default router;
