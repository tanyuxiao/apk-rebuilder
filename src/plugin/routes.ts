import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { modQueue } from '../taskQueue';
import { ApkLibraryItem } from '../types';
import { getPluginPrincipal, requireScope } from './auth';
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
import { getApkItem } from '../apkLibrary';
import { updateTask, logTask, getTaskForTenant } from '../taskStore';
import { fetchArtifactToLocal, getArtifact } from '../artifactService';

export function createPluginRouter(): Router {
  const router = Router();

  router.get('/manifest', (_req: Request, res: Response) => {
    ok(res, getPluginManifest());
  });

  router.post('/execute', async (req: Request, res: Response) => {
    try {
      const principal = getPluginPrincipal(req);
      requireScope(principal, 'apk.mod.run');

      const body = (req.body || {}) as Record<string, unknown>;
      const source = (body.input as any)?.source;
      const modifications = (body.input as any)?.modifications || {};
      const options = (body.input as any)?.options || {};

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
        const item = getApkItem(libraryItemId);
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
