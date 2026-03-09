import fs from 'node:fs';
import path from 'node:path';
import { Router, Request, Response } from 'express';
import { getApkItem, touchApkItem } from './apkLibrary';
import { fetchArtifactToLocal, getArtifact, uploadArtifact } from './artifactService';
import { PLUGIN_MANIFEST_PATH } from './config';
import { parseApkInfo } from './manifestService';
import { getPluginPrincipal, requireScope } from './pluginAuth';
import { modQueue } from './taskQueue';
import { createTask, getTaskForTenant, logTask, updateTask } from './taskStore';
import { ApkInfo, ApkLibraryItem, FilePatch, ModPayload, Task, UnityPatch } from './types';
import { isValidPackageName, isValidVersionCode, normalizeRelPath, toSafeFileStem } from './validators';

type PluginExecuteBody = {
  input?: {
    source?: {
      artifactId?: string;
      libraryItemId?: string;
    };
    modifications?: {
      appName?: string;
      packageName?: string;
      versionName?: string;
      versionCode?: string;
      iconArtifactId?: string;
      unityConfigPath?: string;
      unityPatches?: UnityPatch[];
      filePatches?: FilePatch[];
    };
    options?: {
      reuseDecodedCache?: boolean;
      async?: boolean;
    };
  };
};

function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ success: true, data });
}

function fail(res: Response, status: number, message: string, code?: string, details?: unknown): void {
  res.status(status).json({ success: false, error: { message, code, details } });
}

function getPluginManifest(): unknown {
  return JSON.parse(fs.readFileSync(PLUGIN_MANIFEST_PATH, 'utf8')) as unknown;
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
  task.apkInfo.iconUrl = null;
  return updateTask(task);
}

function startTaskFromLibraryItem(item: ApkLibraryItem, tenantId: string, userId: string | null): { task: Task; cacheHit: boolean } {
  if (!fs.existsSync(item.filePath)) {
    throw new Error('APK file is missing from storage');
  }

  const task = createTask(item.filePath, item.name || path.basename(item.filePath), item.id, tenantId, userId);
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
  }

  return { task, cacheHit };
}

function createTaskFromArtifact(artifactId: string, tenantId: string, userId: string | null): Task {
  const localPath = fetchArtifactToLocal(artifactId, tenantId);
  const fileName = path.basename(localPath);
  return createTask(localPath, fileName, null, tenantId, userId);
}

function mapPluginError(err: unknown): { status: number; code: string; message: string } {
  const message = String(err instanceof Error ? err.message : err);
  if (message.includes('Missing bearer token') || message.includes('Invalid token') || message.includes('Token expired')) {
    return { status: 401, code: 'UNAUTHORIZED', message };
  }
  if (message.includes('pluginId') || message.includes('required scope')) {
    return { status: 403, code: 'FORBIDDEN', message };
  }
  if (message.includes('Artifact not found')) {
    return { status: 404, code: 'ARTIFACT_NOT_FOUND', message };
  }
  return { status: 400, code: 'BAD_REQUEST', message };
}

function validateModifications(modifications: PluginExecuteBody['input'] extends infer T ? any : never): void {
  if (!modifications) {
    throw new Error('Missing modifications');
  }
  if (modifications.packageName && !isValidPackageName(String(modifications.packageName))) {
    throw new Error('Invalid package name format');
  }
  if (modifications.versionCode && !isValidVersionCode(String(modifications.versionCode))) {
    throw new Error('versionCode must be numeric');
  }
  if (modifications.unityConfigPath) {
    normalizeRelPath(String(modifications.unityConfigPath));
  }
  for (const patch of modifications.filePatches || []) {
    normalizeRelPath(String(patch.path || ''));
  }
}

function hasAnyModification(payload: ModPayload): boolean {
  return Boolean(
    payload.appName ||
      payload.packageName ||
      payload.versionName ||
      payload.versionCode ||
      payload.iconUploadPath ||
      payload.unityPatches.length ||
      payload.filePatches.length,
  );
}

function mapProgress(task: Task): { stage: string; message: string } {
  const lastLog = task.logs[task.logs.length - 1] || '';
  if (lastLog.includes('decompile')) {
    return { stage: 'decompile', message: lastLog };
  }
  if (lastLog.includes('Unity param updated')) {
    return { stage: 'patching', message: lastLog };
  }
  if (lastLog.includes('Build apk')) {
    return { stage: 'building', message: lastLog };
  }
  if (lastLog.includes('Sign apk')) {
    return { stage: 'signing', message: lastLog };
  }
  if (lastLog.includes('Mod workflow finished')) {
    return { stage: 'finished', message: lastLog };
  }
  return { stage: task.status, message: lastLog };
}

function ensureUploadedArtifact(task: Task): Task {
  if (task.status !== 'success' || !task.signedApkPath || !fs.existsSync(task.signedApkPath)) {
    return task;
  }
  if (task.outputArtifactId) {
    return task;
  }

  const appName = task.apkInfo?.appName?.trim() || '';
  const fileName = `${appName ? toSafeFileStem(appName) : `modded-${task.id}`}.apk`;
  const artifact = uploadArtifact(task.signedApkPath, {
    tenantId: task.tenantId,
    fileName,
    kind: 'apk',
    mimeType: 'application/vnd.android.package-archive',
    sourceRunId: task.id,
  });
  task.outputArtifactId = artifact.id;
  task.outputArtifactName = artifact.name;
  return updateTask(task);
}

async function buildModPayload(
  tenantId: string,
  modifications: NonNullable<PluginExecuteBody['input']>['modifications'],
): Promise<ModPayload> {
  const unityPatches = Array.isArray(modifications?.unityPatches) ? modifications.unityPatches : [];
  const filePatches = Array.isArray(modifications?.filePatches) ? modifications.filePatches : [];
  const normalizedFilePatches: FilePatch[] = [];

  for (const patch of filePatches) {
    const normalizedPatch: FilePatch = {
      path: String(patch.path || '').trim(),
      mode: patch.mode,
      content: patch.content || null,
      matchText: patch.matchText || null,
      replaceText: patch.replaceText || null,
      regex: Boolean(patch.regex),
      replacementBase64: patch.replacementBase64 || null,
      replacementArtifactId: patch.replacementArtifactId || null,
    };
    if (normalizedPatch.mode === 'file_replace' && normalizedPatch.replacementArtifactId && !normalizedPatch.replacementBase64) {
      const replacementPath = fetchArtifactToLocal(normalizedPatch.replacementArtifactId, tenantId);
      normalizedPatch.replacementBase64 = fs.readFileSync(replacementPath).toString('base64');
    }
    normalizedFilePatches.push(normalizedPatch);
  }

  let iconUploadPath: string | null = null;
  if (modifications?.iconArtifactId) {
    iconUploadPath = fetchArtifactToLocal(modifications.iconArtifactId, tenantId);
  }

  return {
    appName: modifications?.appName?.trim() || null,
    packageName: modifications?.packageName?.trim() || null,
    versionName: modifications?.versionName?.trim() || null,
    versionCode: modifications?.versionCode?.trim() || null,
    iconUploadPath,
    unityConfigPath: modifications?.unityConfigPath?.trim() || null,
    unityPatches,
    filePatches: normalizedFilePatches,
  };
}

export function createPluginRouter(): Router {
  const router = Router();

  router.get('/manifest', (_req, res) => {
    ok(res, getPluginManifest());
  });

  router.post('/execute', async (req: Request, res: Response) => {
    try {
      const principal = getPluginPrincipal(req);
      requireScope(principal, 'apk.mod.run');

      const body = (req.body || {}) as PluginExecuteBody;
      const source = body.input?.source;
      const modifications = body.input?.modifications || {};
      const options = body.input?.options || {};

      const artifactId = String(source?.artifactId || '').trim();
      const libraryItemId = String(source?.libraryItemId || '').trim();
      if (!artifactId && !libraryItemId) {
        fail(res, 400, 'source.artifactId or source.libraryItemId is required', 'BAD_REQUEST');
        return;
      }
      if (artifactId && libraryItemId) {
        fail(res, 400, 'source.artifactId and source.libraryItemId are mutually exclusive', 'BAD_REQUEST');
        return;
      }

      validateModifications(modifications);
      const payload = await buildModPayload(principal.tenantId, modifications);
      if (!hasAnyModification(payload)) {
        fail(
          res,
          400,
          'At least one field is required: appName, packageName, versionName, versionCode, icon, unityPatches, filePatches',
          'BAD_REQUEST',
        );
        return;
      }

      let task: Task;
      let cacheHit = false;
      if (libraryItemId) {
        const item = getApkItem(libraryItemId);
        if (!item) {
          fail(res, 404, 'APK not found in library', 'NOT_FOUND');
          return;
        }
        const result = startTaskFromLibraryItem(item, principal.tenantId, principal.userId);
        task = result.task;
        cacheHit = result.cacheHit;
      } else {
        task = createTaskFromArtifact(artifactId, principal.tenantId, principal.userId);
      }

      task.status = 'queued';
      task.error = null;
      task.errorCode = null;
      updateTask(task);
      logTask(task, `Plugin execute requested (async=${options.async !== false}, reuseDecodedCache=${options.reuseDecodedCache !== false})`);
      void modQueue.add('apk-mod', { type: 'plugin-run', taskId: task.id, payload });

      ok(res, { runId: task.id, status: task.status, cacheHit });
    } catch (error) {
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  router.get('/runs/:runId', (req: Request, res: Response) => {
    try {
      const principal = getPluginPrincipal(req);
      requireScope(principal, 'apk.mod.read');

      const task = getTaskForTenant(String(req.params['runId']), principal.tenantId);
      if (!task) {
        fail(res, 404, 'Task not found', 'TASK_NOT_FOUND');
        return;
      }

      const updatedTask = ensureUploadedArtifact(task);
      const artifacts = updatedTask.outputArtifactId
        ? [{ artifactId: updatedTask.outputArtifactId, name: updatedTask.outputArtifactName, kind: 'apk' }]
        : [];

      ok(res, {
        runId: updatedTask.id,
        status: updatedTask.status,
        createdAt: updatedTask.createdAt,
        updatedAt: updatedTask.updatedAt,
        progress: mapProgress(updatedTask),
        apkInfo: updatedTask.apkInfo || null,
        artifacts,
        error: updatedTask.error
          ? {
              code: updatedTask.errorCode || 'TASK_FAILED',
              message: updatedTask.error,
            }
          : null,
      });
    } catch (error) {
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  router.get('/artifacts/:artifactId', (req: Request, res: Response) => {
    try {
      const principal = getPluginPrincipal(req);
      requireScope(principal, 'apk.mod.read');
      const artifactId = String(req.params['artifactId']);
      const localPath = fetchArtifactToLocal(artifactId, principal.tenantId);
      const artifact = getArtifact(artifactId, principal.tenantId);
      res.download(localPath, artifact?.name || path.basename(localPath));
    } catch (error) {
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  return router;
}
