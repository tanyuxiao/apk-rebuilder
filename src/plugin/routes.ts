import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { modQueue } from '../taskQueue';
import { ApkLibraryItem } from '../types';
import { getLoosePrincipal, requireScope } from './auth';
import {
  ok,
  fail,
} from '../common/response';
import {
  getPluginManifest,
  mapPluginError,
  validateModifications,
  hasAnyModification,
  buildModPayload,
} from './helpers';
import { mapProgress, ensureUploadedArtifact, createTaskFromLibraryItem, createTaskFromArtifact } from '../common/taskUtils';
import { deleteApkItem, getApkItem, listApkItems } from '../apkLibrary';
import { updateTask, logTask, getTaskForTenant } from '../taskStore';
import { fetchArtifactToLocal, getArtifact, uploadArtifact } from '../artifactService';
import {
  readStandardPackageConfig,
  updateStandardPackageConfig,
  resolveStandardLibraryItem,
} from './standardPackage';
import { MOD_UPLOAD_DIR } from '../config';

const upload = multer({ storage: multer.memoryStorage() });

export function createPluginRouter(): Router {
  const router = Router();

  router.get('/manifest', (_req: Request, res: Response) => {
    ok(res, getPluginManifest());
  });

  router.post('/execute', async (req: Request, res: Response) => {
    try {
      const principal = getLoosePrincipal(req);
      requireScope(principal, 'apk.mod.run');

      const body = (req.body || {}) as Record<string, unknown>;
      const source = (body.input as any)?.source;
      const modifications = (body.input as any)?.modifications || {};
      const options = (body.input as any)?.options || {};
      const useStandardPackage = options?.useStandardPackage === true;

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

      let task;
      let cacheHit = false;
      if (libraryItemId) {
        let resolvedId = libraryItemId;
        if (useStandardPackage) {
        const resolved = resolveStandardLibraryItem(principal.tenantId);
          if (!resolved.libraryItemId) {
            fail(res, 409, resolved.reason || 'STANDARD_PACKAGE_NOT_AVAILABLE', 'STANDARD_PACKAGE_NOT_AVAILABLE');
            return;
          }
          resolvedId = resolved.libraryItemId;
        }

      const item = getApkItem(resolvedId, principal.tenantId);
        if (!item) {
          fail(res, 404, 'APK not found in library', 'NOT_FOUND');
          return;
        }
        const result = createTaskFromLibraryItem(item, principal.tenantId, principal.userId);
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

  router.post('/icon-upload', upload.single('icon'), (req: Request, res: Response) => {
    try {
      const principal = getLoosePrincipal(req);
      requireScope(principal, 'apk.mod.run');
      const file = (req as any).file as { originalname: string; mimetype: string; buffer: Buffer } | undefined;
      if (!file) {
        fail(res, 400, 'Missing icon file', 'BAD_REQUEST');
        return;
      }
      const ext = path.extname(file.originalname || '').toLowerCase();
      const allowedExt = new Set(['.png', '.jpg', '.jpeg', '.webp']);
      if (ext && !allowedExt.has(ext)) {
        fail(res, 400, 'Unsupported icon format', 'BAD_REQUEST');
        return;
      }
      const safeExt = allowedExt.has(ext) ? ext : '.png';
      const tempName = `${randomUUID()}${safeExt}`;
      const tempPath = path.join(MOD_UPLOAD_DIR, tempName);
      fs.writeFileSync(tempPath, file.buffer);
      const artifact = uploadArtifact(tempPath, {
        tenantId: principal.tenantId,
        fileName: file.originalname || tempName,
        kind: 'icon',
        mimeType: file.mimetype || 'image/png',
      });
      fs.rmSync(tempPath, { force: true });
      ok(res, { artifactId: artifact.id, name: artifact.name });
    } catch (error) {
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  // Public read-only standard package config (used by embed form)
  router.get('/standard-package', (req: Request, res: Response) => {
    try {
      const principal = getLoosePrincipal(req);
      requireScope(principal, 'apk.mod.read');
      const config = readStandardPackageConfig(principal.tenantId);
      ok(res, {
        standardLibraryItemId: config.activeStandardId,
        previousStandardLibraryItemId: config.previousStandardId,
        lockedUntil: config.lockedUntil,
      });
    } catch (error) {
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  // Admin standard package management
  router.get('/admin/standard-package', (req: Request, res: Response) => {
    try {
      const principal = getLoosePrincipal(req);
      ok(res, readStandardPackageConfig(principal.tenantId));
    } catch (error) {
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  router.get('/admin/apk-library', (req: Request, res: Response) => {
    try {
      const principal = getLoosePrincipal(req);
      const config = readStandardPackageConfig(principal.tenantId);
      ok(res, {
        items: listApkItems(principal.tenantId),
        standard: {
          activeStandardId: config.activeStandardId,
          previousStandardId: config.previousStandardId,
          disabledIds: config.disabledIds,
        },
      });
    } catch (error) {
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  router.delete('/admin/apk-library/:itemId', (req: Request, res: Response) => {
    try {
      const principal = getLoosePrincipal(req);
      const itemId = String(req.params.itemId || '').trim();
      if (!itemId) {
        fail(res, 400, 'itemId is required', 'BAD_REQUEST');
        return;
      }
      const current = readStandardPackageConfig(principal.tenantId);
      if (current.activeStandardId === itemId || current.previousStandardId === itemId || current.disabledIds.includes(itemId)) {
        const next = {
          activeStandardId: current.activeStandardId === itemId ? null : current.activeStandardId,
          previousStandardId: current.previousStandardId === itemId ? null : current.previousStandardId,
          disabledIds: current.disabledIds.filter(id => id !== itemId),
        };
        updateStandardPackageConfig(next, principal.tenantId);
      }

      const removed = deleteApkItem(itemId, principal.tenantId);
      if (!removed) {
        fail(res, 404, 'APK not found in library', 'NOT_FOUND');
        return;
      }
      ok(res, { deleted: true, itemId });
    } catch (error) {
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  router.put('/admin/standard-package', (req: Request, res: Response) => {
    try {
      const principal = getLoosePrincipal(req);
      const current = readStandardPackageConfig(principal.tenantId);
      const now = Date.now();
      if (current.lockedUntil && now < current.lockedUntil) {
        fail(res, 409, 'Standard package is locked, retry later', 'STANDARD_PACKAGE_LOCKED');
        return;
      }

      const activeStandardId = String(req.body?.standardLibraryItemId || '').trim() || null;
      const next: any = {
        activeStandardId,
        previousStandardId: current.activeStandardId || null,
        lockedUntil: now + 2000,
      };

      if (Array.isArray(req.body?.disabledIds)) {
        next.disabledIds = req.body.disabledIds.filter((x: unknown) => typeof x === 'string');
      }

      ok(res, updateStandardPackageConfig(next, principal.tenantId));
    } catch (error) {
      const mapped = mapPluginError(error);
      fail(res, mapped.status, mapped.message, mapped.code);
    }
  });

  router.get('/runs/:runId', (req: Request, res: Response) => {
    try {
      const principal = getLoosePrincipal(req);
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
      const principal = getLoosePrincipal(req);
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
