import fs from 'fs';
import path from 'path';
import {
  ApkLibraryItem,
  Task,
  FilePatch,
  UnityPatch,
  ModPayload,
} from '../types';
import { isValidPackageName, isValidVersionCode } from '../validators';
import { fetchArtifactToLocal } from '../artifactService';
import { updateTask } from '../taskStore';
import { normalizeRelPath } from '../validators';
import { toSafeFileStem } from '../validators';
import { PLUGIN_MANIFEST_PATH } from '../config';
import {
  createTaskFromLibraryItem,
  createTaskFromArtifact,
  attachCachedIconForTask,
  ensureUploadedArtifact,
  mapProgress,
} from '../common/taskUtils';

export function getPluginManifest(): unknown {
  return JSON.parse(fs.readFileSync(PLUGIN_MANIFEST_PATH, 'utf8')) as unknown;
}

export function mapPluginError(err: unknown): { status: number; code: string; message: string } {
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

export function validateModifications(modifications: unknown): void {
  const m: any = modifications;
  if (!m) {
    throw new Error('Missing modifications');
  }
  if (m.packageName && !isValidPackageName(String(m.packageName))) {
    throw new Error('Invalid package name format');
  }
  if (m.versionCode && !isValidVersionCode(String(m.versionCode))) {
    throw new Error('versionCode must be numeric');
  }
  if (m.unityConfigPath) {
    normalizeRelPath(String(m.unityConfigPath));
  }
  for (const patch of m.filePatches || []) {
    normalizeRelPath(String(patch.path || ''));
  }
}

export function hasAnyModification(payload: ModPayload): boolean {
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

export async function buildModPayload(
  tenantId: string,
  modifications: NonNullable<ModPayload> & { [key: string]: any },
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
