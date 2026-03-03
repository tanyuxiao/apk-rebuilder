import { Router } from 'express';
import { ok } from '../utils/response.js';

export const healthRouter = Router();

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [System]
 *     summary: Health check
 *     responses:
 *       200:
 *         description: Service is alive
 */
healthRouter.get('/health', (_req, res) => {
  ok(res, { ok: true, service: 'backend' });
});
