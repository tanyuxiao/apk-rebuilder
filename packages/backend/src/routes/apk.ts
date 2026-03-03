import { Router } from 'express';
import fse from 'fs-extra';
import multer from 'multer';
import path from 'node:path';
import { modUploadDir, uploadDir } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import type { UnityPatch } from '../models/task.js';
import { fail, ok } from '../utils/response.js';
import { toSafeFileStem } from '../utils/validators.js';
import { createTask, getTask, logTask } from '../services/task-store.js';
import { getToolchainStatus, parseUnityPatchesInput, readUnityConfig, runDecompileTask, runModTask } from '../services/apk-service.js';

const upload = multer({ dest: uploadDir });
const modUpload = multer({ dest: modUploadDir });

export const apkRouter = Router();
apkRouter.use('/api/mod', requireAuth);
apkRouter.use('/api/download', requireAuth);

/**
 * @openapi
 * /api/tools:
 *   get:
 *     tags: [System]
 *     summary: Check toolchain status
 *     responses:
 *       200:
 *         description: Toolchain status
 */
apkRouter.get('/api/tools', async (_req, res) => {
  const result = await getToolchainStatus();
  ok(res, result);
});

/**
 * @openapi
 * /api/upload:
 *   post:
 *     tags: [APK]
 *     summary: Upload APK and trigger decompile
 *     responses:
 *       200:
 *         description: Upload accepted
 */
apkRouter.post('/api/upload', upload.single('apk'), (req, res) => {
  if (!req.file) {
    fail(res, 400, 'Missing apk file field "apk"', { code: 'BAD_REQUEST' });
    return;
  }

  const task = createTask(req.file.path, req.file.originalname);
  void runDecompileTask(task);

  ok(res, {
    id: task.id,
    status: task.status,
    createdAt: task.createdAt
  });
});

/**
 * @openapi
 * /api/status/{id}:
 *   get:
 *     tags: [APK]
 *     summary: Query task status
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Task status
 *       404:
 *         description: Task not found
 */
apkRouter.get('/api/status/:id', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) {
    fail(res, 404, 'Task not found', { code: 'NOT_FOUND' });
    return;
  }
  ok(res, {
    id: task.id,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    logs: task.logs,
    error: task.error,
    downloadReady: Boolean(task.signedApkPath && task.status === 'success'),
    apkInfo: task.apkInfo
  });
});

apkRouter.get('/api/icon/:id', (req, res) => {
  const task = getTask(req.params.id);
  if (!task || !task.iconFilePath || !fse.existsSync(task.iconFilePath)) {
    fail(res, 404, 'Icon not found', { code: 'NOT_FOUND' });
    return;
  }
  res.sendFile(task.iconFilePath);
});

/**
 * @openapi
 * /api/unity-config/{id}:
 *   get:
 *     tags: [Unity]
 *     summary: Read unity config json from decoded APK
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Unity config content
 */
apkRouter.get('/api/unity-config/:id', async (req, res) => {
  const task = getTask(req.params.id);
  if (!task) {
    fail(res, 404, 'Task not found', { code: 'NOT_FOUND' });
    return;
  }

  try {
    const result = await readUnityConfig(task, String(req.query.path || ''));
    ok(res, result);
  } catch (error) {
    fail(res, 400, error instanceof Error ? error.message : String(error), { code: 'BAD_REQUEST' });
  }
});

/**
 * @openapi
 * /api/mod:
 *   post:
 *     tags: [APK]
 *     summary: Modify and rebuild APK
 *     responses:
 *       200:
 *         description: Mod task queued
 */
apkRouter.post('/api/mod', modUpload.single('icon'), async (req, res) => {
  const id = String(req.body.id || '').trim();
  const appName = String(req.body.appName || '').trim() || undefined;
  const packageName = String(req.body.packageName || '').trim() || undefined;
  const versionName = String(req.body.versionName || '').trim() || undefined;
  const versionCode = String(req.body.versionCode || '').trim() || undefined;
  const unityConfigPath = String(req.body.unityConfigPath || '').trim() || undefined;
  let unityPatches: UnityPatch[] = [];
  try {
    unityPatches = parseUnityPatchesInput(req.body.unityPatches);
  } catch (error) {
    fail(res, 400, error instanceof Error ? error.message : String(error), { code: 'BAD_REQUEST' });
    return;
  }

  if (!id) {
    fail(res, 400, 'Missing task id', { code: 'BAD_REQUEST' });
    return;
  }

  const task = getTask(id);
  if (!task) {
    fail(res, 404, 'Task not found', { code: 'NOT_FOUND' });
    return;
  }
  if (task.status === 'processing') {
    fail(res, 409, 'Task is still processing', { code: 'CONFLICT' });
    return;
  }
  if (!task.decodedDir || !fse.existsSync(task.decodedDir)) {
    fail(res, 400, 'Task is not ready for mod, decompile first', { code: 'BAD_REQUEST' });
    return;
  }

  const iconFile = req.file;
  const iconExt = iconFile ? path.extname(iconFile.originalname).toLowerCase() : '';
  if (iconFile && !['.png', '.webp', '.jpg', '.jpeg'].includes(iconExt)) {
    fail(res, 400, 'Icon format must be one of: .png, .webp, .jpg, .jpeg', { code: 'BAD_REQUEST' });
    return;
  }
  let iconUploadPath: string | undefined;
  if (iconFile?.path) {
    iconUploadPath = `${iconFile.path}${iconExt || '.png'}`;
    await fse.move(iconFile.path, iconUploadPath, { overwrite: true });
  }

  if (!appName && !packageName && !versionName && !versionCode && !iconFile && !unityPatches.length) {
    fail(res, 400, 'At least one field is required: appName, packageName, versionName, versionCode, icon, unityPatches', {
      code: 'BAD_REQUEST'
    });
    return;
  }

  task.logs.push('');
  logTask(task, 'Queue mod workflow');

  void runModTask(task, {
    appName,
    packageName,
    versionName,
    versionCode,
    iconUploadPath,
    unityConfigPath,
    unityPatches
  });

  ok(res, { id: task.id, status: task.status });
});

/**
 * @openapi
 * /api/download/{id}:
 *   get:
 *     tags: [APK]
 *     summary: Download signed APK
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: APK file stream
 */
apkRouter.get('/api/download/:id', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) {
    fail(res, 404, 'Task not found', { code: 'NOT_FOUND' });
    return;
  }
  if (!task.signedApkPath || !fse.existsSync(task.signedApkPath) || task.status !== 'success') {
    fail(res, 404, 'Signed apk is not ready', { code: 'NOT_FOUND' });
    return;
  }

  const appName = task.apkInfo?.appName?.trim() || '';
  const stem = appName ? toSafeFileStem(appName) : `modded-${task.id}`;
  const downloadName = `${stem}.apk`;
  res.download(task.signedApkPath, downloadName);
});
