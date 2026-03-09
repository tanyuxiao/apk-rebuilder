import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import mime from 'mime-types';
import {
  API_KEY,
  AUTH_ENABLED,
  FRONTEND_PUBLIC_DIR,
  HOST,
  MOD_UPLOAD_DIR,
  PORT,
  ensureRuntimeDirs,
} from './config';
import { addOrGetApkItem, deleteApkItem, getApkItem, listApkItems, touchApkItem } from './apkLibrary';
import { runDecompileTask, runModTask } from './buildService';
import { readEditableFile, parseFilePatchesInput } from './filePatchService';
import { parseApkInfo } from './manifestService';
import { createTask, getTask, listTasks, logTask, updateTask } from './taskStore';
import { getToolchainStatus } from './toolchain';
import { readUnityConfig, parseUnityPatchesInput } from './unityConfigService';
import { ApkInfo, ApkLibraryItem, ModPayload, Task } from './types';
import { normalizeRelPath, toSafeFileStem } from './validators';
import { createPluginRouter } from './pluginRoutes';

import rateLimit from 'express-rate-limit';
import './taskQueue'; // Initialize BullMQ worker
import { modQueue } from './taskQueue';

const upload = multer({ storage: multer.memoryStorage() });
const modUpload = multer({ storage: multer.memoryStorage() });
const app = express();
const MAX_TREE_NODES = 5000;
const MAX_FILE_READ_BYTES = 512 * 1024;

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { success: false, error: { message: 'Too many requests, please try again later.', code: 'RATE_LIMIT_EXCEEDED' } },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', apiLimiter);
app.use('/plugin', apiLimiter);

ensureRuntimeDirs();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use((req, _res, next) => {
  console.info(`request method=${req.method} path=${req.path}`);
  next();
});

function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ success: true, data });
}

function fail(res: Response, status: number, message: string, code?: string, details?: unknown): void {
  res.status(status).json({ success: false, error: { message, code, details } });
}

function extractToken(req: Request): string {
  const auth = req.header('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return (req.header('x-api-key') || String(req.query['api_key'] || '')).trim();
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!AUTH_ENABLED || !API_KEY) {
    next();
    return;
  }
  const incoming = Buffer.from(extractToken(req));
  const expected = Buffer.from(API_KEY);
  if (incoming.length !== expected.length || !timingSafeEqual(incoming, expected)) {
    fail(res, 401, 'Unauthorized', 'UNAUTHORIZED');
    return;
  }
  next();
}

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

function attachCachedIconForTask(task: Task): Task {
  if (!task.decodedDir || !task.apkInfo) {
    return task;
  }
  const iconRef = String(task.apkInfo.iconRef || '').trim();
  if (!iconRef.startsWith('@') || !iconRef.includes('/')) {
    task.iconFilePath = null;
    task.apkInfo.iconUrl = null;
    return updateTask(task);
  }

  const [resType, resName] = iconRef.slice(1).split('/', 2);
  const resRoot = path.join(task.decodedDir, 'res');
  if (!fs.existsSync(resRoot)) {
    task.iconFilePath = null;
    task.apkInfo.iconUrl = null;
    return updateTask(task);
  }

  const densityRank = ['xxxhdpi', 'xxhdpi', 'xhdpi', 'hdpi', 'mdpi', 'anydpi'];
  const candidates: string[] = [];
  for (const folder of fs.readdirSync(resRoot)) {
    const folderPath = path.join(resRoot, folder);
    if (!fs.statSync(folderPath).isDirectory()) {
      continue;
    }
    if (folder !== resType && !folder.startsWith(`${resType}-`)) {
      continue;
    }
    for (const child of fs.readdirSync(folderPath)) {
      const ext = path.extname(child).toLowerCase();
      if (path.basename(child, ext) === resName && ['.png', '.webp', '.jpg', '.jpeg'].includes(ext)) {
        candidates.push(path.join(folderPath, child));
      }
    }
  }

  candidates.sort((left, right) => {
    const score = (target: string): number => {
      const directory = path.basename(path.dirname(target));
      const index = densityRank.findIndex(key => directory.includes(key));
      return index >= 0 ? index : densityRank.length;
    };
    return score(left) - score(right);
  });

  task.iconFilePath = candidates[0] || null;
  task.apkInfo.iconUrl = task.iconFilePath ? `/api/icon/${task.id}?v=${fs.statSync(task.iconFilePath).mtimeMs}` : null;
  return updateTask(task);
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
      attachCachedIconForTask(task);
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

app.get('/health', (_req, res) => ok(res, { ok: true, service: 'backend', host: HOST, port: PORT }));
app.get('/api/tools', (_req, res) => ok(res, getToolchainStatus()));

app.post('/api/upload', upload.single('apk'), (req, res) => {
  if (!req.file) {
    fail(res, 400, 'Missing apk file field "apk"', 'BAD_REQUEST');
    return;
  }
  const tenantId = req.header('x-tenant-id');
  const { item, created } = addOrGetApkItem(req.file.originalname || 'uploaded.apk', req.file.buffer);
  ok(res, { ...startTaskFromLibraryItem(item, tenantId), deduplicatedUpload: !created });
});

app.get('/api/library/apks', (_req, res) => ok(res, { items: listApkItems() }));

app.post('/api/library/use', (req, res) => {
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

app.delete('/api/library/apks/:itemId', (req, res) => {
  if (!deleteApkItem(req.params['itemId'])) {
    fail(res, 404, 'APK not found in library', 'NOT_FOUND');
    return;
  }
  ok(res, { deleted: true, id: req.params['itemId'] });
});

app.get('/api/status/:taskId', (req, res) => {
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
    logs: task.logs,
    error: task.error,
    downloadReady: Boolean(task.signedApkPath && task.status === 'success'),
    apkInfo: task.apkInfo || null,
  });
});

app.get('/api/tasks', (_req, res) => {
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
    })),
  });
});

app.get('/api/icon/:taskId', (req, res) => {
  const task = getTask(req.params['taskId']);
  if (!task?.iconFilePath || !fs.existsSync(task.iconFilePath)) {
    fail(res, 404, 'Icon not found', 'NOT_FOUND');
    return;
  }
  res.sendFile(task.iconFilePath);
});

app.get('/api/unity-config/:taskId', (req, res) => {
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

app.get('/api/edit-file/:taskId', (req, res) => {
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

app.get('/api/files/:taskId/tree', (req, res) => {
  try {
    const decodedRoot = getDecodedRootOrThrow(req.params['taskId']);
    ok(res, { taskId: req.params['taskId'], rootName: path.basename(decodedRoot), tree: buildTreeNode(decodedRoot, decodedRoot, { count: 0 }) });
  } catch (error) {
    fail(res, String(error).includes('Task not found') ? 404 : 400, String(error), String(error).includes('Task not found') ? 'NOT_FOUND' : 'BAD_REQUEST');
  }
});

app.get('/api/files/:taskId/content', (req, res) => {
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

app.post('/api/mod', requireAuth, modUpload.single('icon'), (req, res) => {
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

  if (!payload.appName && !payload.packageName && !payload.versionName && !payload.versionCode && !payload.iconUploadPath && payload.unityPatches.length === 0 && payload.filePatches.length === 0) {
    fail(res, 400, 'At least one field is required: appName, packageName, versionName, versionCode, icon, unityPatches, filePatches', 'BAD_REQUEST');
    return;
  }

  task.logs.push('');
  logTask(task, 'Queue mod workflow');
  void modQueue.add('apk-mod', { type: 'mod', taskId: task.id, payload });
  ok(res, { id: task.id, status: task.status });
});

app.get('/api/download/:taskId', requireAuth, (req, res) => {
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

app.use('/plugin', createPluginRouter());

app.get('*', (req, res) => {
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

export default app;
