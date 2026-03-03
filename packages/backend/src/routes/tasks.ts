import { Router } from 'express';
import { listTasks } from '../services/task-store.js';
import { ok } from '../utils/response.js';

export function createTaskRouter(): Router {
  const router = Router();

  /**
   * @openapi
   * /api/tasks:
   *   get:
   *     tags: [APK]
   *     summary: List task brief info
   *     responses:
   *       200:
   *         description: Task list
   */
  router.get('/api/tasks', (_req, res) => {
    const items = listTasks()
      .map((task) => ({
        id: task.id,
        status: task.status,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        error: task.error,
        downloadReady: Boolean(task.signedApkPath && task.status === 'success'),
        apkInfo: task.apkInfo
      }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    ok(res, { items });
  });

  return router;
}
