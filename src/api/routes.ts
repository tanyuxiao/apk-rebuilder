import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import express, { Router, Request, Response } from 'express';
import multer from 'multer';
import mime from 'mime-types';
import { getApkItem, listApkItems, addOrGetApkItem, deleteApkItem, touchApkItem } from '../apkLibrary';
import { runDecompileTask, runModTask } from '../buildService';
import { modQueue } from '../taskQueue';
import { readEditableFile, parseFilePatchesInput } from '../filePatchService';
import { parseApkInfo } from '../manifestService';
import { createTask, getTask, listTasks, logTask, updateTask } from '../taskStore';
import { getToolchainStatus } from '../toolchain';
import { readUnityConfig, parseUnityPatchesInput } from '../unityConfigService';
import { ApkInfo, ApkLibraryItem, ModPayload } from '../types';
import { normalizeRelPath, toSafeFileStem } from '../validators';
import { FRONTEND_PUBLIC_DIR, MOD_UPLOAD_DIR } from '../config';
import { requireAuth } from '../middleware/auth';
import { ok, fail } from '../common/response';

const upload = multer({ storage: multer.memoryStorage() });
const modUpload = multer({ storage: multer.memoryStorage() });

export function createApiRouter(): Router {
  const router = Router();

  const MAX_TREE_NODES = 5000;
  const MAX_FILE_READ_BYTES = 512 * 1024;

  function getDecodedRootOrThrow(taskId: string): string {
    const task = getTask(taskId);
    if (!task) {
      throw new Error('Task not found');
    }
    if (!task.decodedDir || !fs.existsSync(task.decodedDir) || !fs.statSync(task.decodedDir).isDirectory()) {
      throw new Error('Task is not ready, decompile first');
    }
    return task.decodedDir;
  }

  function safeJoinDecoded(decodedRoot: string, relPath: string): string {
    const normalized = normalizeRelPath(relPath);
    const base = path.resolve(decodedRoot);
    const target = path.resolve(base, normalized);
    if (!target.startsWith(base)) {
      throw new Error('Invalid path');
    }
    return target;
  }

  function buildTreeNode(baseRoot: string, current: string, counter: { count: number }): Record<string, unknown> {
    counter.count += 1;
    if (counter.count > MAX_TREE_NODES) {
      throw new Error(`Too many files (> ${MAX_TREE_NODES})`);
    }
    const relPath = current === baseRoot ? '' : path.relative(baseRoot, current).split(path.sep).join('/');
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      const children = fs
        .readdirSync(current)
        .sort((a, b) => a.localeCompare(b))
        .map(child => buildTreeNode(baseRoot, path.join(current, child), counter));
      return { name: path.basename(current), path: relPath, type: 'dir', children };
    }
    return { name: path.basename(current), path: relPath, type: 'file', size: stat.size };
  }

  function startTaskFromLibraryItem(item: ApkLibraryItem, tenantId?: string): Record<string, unknown> {
    if (!fs.existsSync(item.filePath)) {
      throw new Error('APK file is missing from storage');
    }
    const task = createTask(item.filePath, item.name || path.basename(item.filePath), item.id, tenantId);
    const touched = touchApkItem(item.id);
    const activeItem = touched || item;
    const cacheHit = Boolean(activeItem.parsedReady && activeItem.decodeCachePath && fs.existsSync(activeItem.decodeCachePath));

    if (cacheHit && activeItem.decodeCachePath) {
      const decodedDir = path.join(task.workDir, 'decoded');
      fs.mkdirSync(path.dirname(decodedDir), { recursive: true });
      fs.cpSync(activeItem.decodeCachePath, decodedDir, { recursive: true });
      task.decodedDir = decodedDir;
      if (activeItem.apkInfo) {
        task.apkInfo = { ...activeItem.apkInfo, iconUrl: null } as ApkInfo;
      } else {
        parseApkInfo(task);
      }
      task.status = 'success';
      logTask(task, 'Loaded decoded cache from APK library (skip decompile)');
    } else {
      void modQueue.add('apk-mod', { type: 'decompile', taskId: task.id });
    }

    return {
      id: task.id,
      status: task.status,
      createdAt: task.createdAt,
      cacheHit,
      libraryItem: activeItem,
    };
  }

  router.get('/health', (_req, res) => ok(res, { ok: true, service: 'backend' }));
  router.get('/tools', (_req, res) => ok(res, getToolchainStatus()));

  router.post('/upload', upload.single('apk'), (req, res) => {
    if (!req.file) {
      fail(res, 400, 'Missing apk file field "apk"', 'BAD_REQUEST');
      return;
    }
    const tenantId = req.header('x-tenant-id');
    const { item, created } = addOrGetApkItem(req.file.originalname || 'uploaded.apk', req.file.buffer);
    ok(res, { ...startTaskFromLibraryItem(item, tenantId), deduplicatedUpload: !created });
  });

  router.get('/library/apks', (_req, res) => ok(res, { items: listApkItems() }));

  router.post('/library/use', (req, res) => {
    const itemId = String(req.body?.id || '').trim();
    const tenantId = req.header('x-tenant-id');
    if (!itemId) {
      fail(res, 400, 'Missing apk library id', 'BAD_REQUEST');
      return;
    }
    const item = getApkItem(itemId);
    if (!item) {
      fail(res, 404, 'APK not found in library', 'NOT_FOUND');
      return;
    }
    ok(res, startTaskFromLibraryItem(item, tenantId));
  });

  router.delete('/library/apks/:itemId', (req, res) => {
    if (!deleteApkItem(req.params['itemId'])) {
      fail(res, 404, 'APK not found in library', 'NOT_FOUND');
      return;
    }
    ok(res, { deleted: true, id: req.params['itemId'] });
  });

  router.get('/status/:taskId', (req, res) => {
    const task = getTask(req.params['taskId']);
    if (!task) {
      fail(res, 404, 'Task not found', 'NOT_FOUND');
      return;
    }
    ok(res, {
      id: task.id,
      sourceName: task.sourceName,
      status: task.status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      error: task.error,
      downloadReady: Boolean(task.signedApkPath && task.status === 'success'),
      apkInfo: task.apkInfo || null,
      logs: task.logs, // include logs for debugging
    });
  });

  router.get('/tasks', (_req, res) => {
    ok(res, {
      items: listTasks().map(task => ({
        id: task.id,
        sourceName: task.sourceName,
        status: task.status,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        error: task.error,
        downloadReady: Boolean(task.signedApkPath && task.status === 'success'),
        apkInfo: task.apkInfo || null,
        logs: task.logs,
      })),
    });
  });

  router.get('/icon/:taskId', (req, res) => {
    const task = getTask(req.params['taskId']);
    if (!task?.iconFilePath || !fs.existsSync(task.iconFilePath)) {
      fail(res, 404, 'Icon not found', 'NOT_FOUND');
      return;
    }
    res.sendFile(task.iconFilePath);
  });

  router.get('/unity-config/:taskId', (req, res) => {
    const task = getTask(req.params['taskId']);
    if (!task) {
      fail(res, 404, 'Task not found', 'NOT_FOUND');
      return;
    }
    try {
      ok(res, readUnityConfig(task, req.query['path'] ? String(req.query['path']) : undefined));
    } catch (error) {
      fail(res, 400, String(error), 'BAD_REQUEST');
    }
  });

  router.get('/edit-file/:taskId', (req, res) => {
    const task = getTask(req.params['taskId']);
    if (!task) {
      fail(res, 404, 'Task not found', 'NOT_FOUND');
      return;
    }
    try {
      ok(res, readEditableFile(task, String(req.query['path'] || '')));
    } catch (error) {
      fail(res, 400, String(error), 'BAD_REQUEST');
    }
  });

  router.get('/files/:taskId/tree', (req, res) => {
    try {
      const decodedRoot = getDecodedRootOrThrow(req.params['taskId']);
      ok(res, { taskId: req.params['taskId'], rootName: path.basename(decodedRoot), tree: buildTreeNode(decodedRoot, decodedRoot, { count: 0 }) });
    } catch (error) {
      fail(res, String(error).includes('Task not found') ? 404 : 400, String(error), String(error).includes('Task not found') ? 'NOT_FOUND' : 'BAD_REQUEST');
    }
  });

  router.get('/files/:taskId/content', (req, res) => {
    try {
      const decodedRoot = getDecodedRootOrThrow(req.params['taskId']);
      const filePath = safeJoinDecoded(decodedRoot, String(req.query['path'] || ''));
      if (!fs.existsSync(filePath)) {
        fail(res, 404, 'File not found', 'NOT_FOUND');
        return;
      }
      if (fs.statSync(filePath).isDirectory()) {
        fail(res, 400, 'Path is a directory', 'BAD_REQUEST');
        return;
      }
      const blob = fs.readFileSync(filePath);
      const totalSize = blob.byteLength;
      const truncated = totalSize > MAX_FILE_READ_BYTES;
      const preview = blob.subarray(0, MAX_FILE_READ_BYTES);
      const looksBinary = preview.includes(0);
      const relPath = normalizeRelPath(String(req.query['path'] || ''));

      if (looksBinary) {
        ok(res, {
          taskId: req.params['taskId'],
          path: relPath,
          name: path.basename(filePath),
          mime: mime.lookup(filePath) || 'application/octet-stream',
          size: totalSize,
          truncated,
          encoding: 'base64',
          kind: 'binary',
          content: preview.toString('base64'),
        });
        return;
      }

      ok(res, {
        taskId: req.params['taskId'],
        path: relPath,
        name: path.basename(filePath),
        mime: mime.lookup(filePath) || 'text/plain',
        size: totalSize,
        truncated,
        encoding: 'utf-8',
        kind: 'text',
        content: preview.toString('utf8'),
      });
    } catch (error) {
      fail(res, String(error).includes('Task not found') ? 404 : 400, String(error), String(error).includes('Task not found') ? 'NOT_FOUND' : 'BAD_REQUEST');
    }
  });

  router.post('/mod', requireAuth, modUpload.single('icon'), (req, res) => {
    const taskId = String(req.body?.id || '').trim();
    if (!taskId) {
      fail(res, 400, 'Missing task id', 'BAD_REQUEST');
      return;
    }
    const task = getTask(taskId);
    if (!task) {
      fail(res, 404, 'Task not found', 'NOT_FOUND');
      return;
    }
    if (task.status === 'processing') {
      fail(res, 409, 'Task is still processing', 'CONFLICT');
      return;
    }
    if (!task.decodedDir || !fs.existsSync(task.decodedDir)) {
      fail(res, 400, 'Task is not ready for mod, decompile first', 'BAD_REQUEST');
      return;
    }

    let parsedUnityPatches;
    let parsedFilePatches;
    try {
      parsedUnityPatches = parseUnityPatchesInput(req.body?.unityPatches);
      parsedFilePatches = parseFilePatchesInput(req.body?.filePatches);
    } catch (error) {
      fail(res, 400, String(error), 'BAD_REQUEST');
      return;
    }


    let iconUploadPath: string | undefined;
    if (req.file) {
      const iconExt = path.extname(req.file.originalname || '').toLowerCase();
      if (!['.png', '.webp', '.jpg', '.jpeg'].includes(iconExt)) {
        fail(res, 400, 'Icon format must be one of: .png, .webp, .jpg, .jpeg', 'BAD_REQUEST');
        return;
      }
      iconUploadPath = path.join(MOD_UPLOAD_DIR, `${randomUUID()}${iconExt || '.png'}`);
      fs.writeFileSync(iconUploadPath, req.file.buffer);
    }

    const payload: ModPayload = {
      appName: String(req.body?.appName || '').trim() || null,
      packageName: String(req.body?.packageName || '').trim() || null,
      versionName: String(req.body?.versionName || '').trim() || null,
      versionCode: String(req.body?.versionCode || '').trim() || null,
      unityConfigPath: String(req.body?.unityConfigPath || '').trim() || null,
      iconUploadPath: iconUploadPath || null,
      unityPatches: parsedUnityPatches,
      filePatches: parsedFilePatches,
    };

    if (
      !payload.appName &&
      !payload.packageName &&
      !payload.versionName &&
      !payload.versionCode &&
      !payload.iconUploadPath &&
      payload.unityPatches.length === 0 &&
      payload.filePatches.length === 0
    ) {
      fail(
        res,
        400,
        'At least one field is required: appName, packageName, versionName, versionCode, icon, unityPatches, filePatches',
        'BAD_REQUEST',
      );
      return;
    }

    task.logs.push('');
    logTask(task, 'Queue mod workflow');
    void modQueue.add('apk-mod', { type: 'mod', taskId: task.id, payload });
    ok(res, { taskId });
  });

  router.get('/download/:taskId', requireAuth, (req, res) => {
    const task = getTask(String(req.params['taskId']));
    if (!task) {
      fail(res, 404, 'Task not found', 'NOT_FOUND');
      return;
    }
    if (!task.signedApkPath || !fs.existsSync(task.signedApkPath) || task.status !== 'success') {
      fail(res, 404, 'Signed apk is not ready', 'NOT_FOUND');
      return;
    }
    const appName = task.apkInfo?.appName?.trim() || '';
    const stem = appName ? toSafeFileStem(appName) : `modded-${task.id}`;
    res.download(task.signedApkPath, `${stem}.apk`);
  });

  // fallback to static serve
  router.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      fail(res, 404, `Route not found: GET ${req.path}`, 'NOT_FOUND');
      return;
    }
    if (!fs.existsSync(FRONTEND_PUBLIC_DIR)) {
      fail(res, 404, 'Route not found', 'NOT_FOUND');
      return;
    }
    const requested = req.path === '/' ? 'index.html' : req.path.replace(/^\/+/, '');
    const target = path.resolve(FRONTEND_PUBLIC_DIR, requested);
    if (target.startsWith(path.resolve(FRONTEND_PUBLIC_DIR)) && fs.existsSync(target) && fs.statSync(target).isFile()) {
      res.sendFile(target);
      return;
    }
    res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'index.html'));
  });

  return router;
}
