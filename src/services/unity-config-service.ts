import fse from 'fs-extra';
import path from 'node:path';
import type { ModPayload, Task, UnityPatch } from '../models/task.js';
import { logTask } from './task-store.js';

function normalizeUnityConfigPath(input?: string): string {
  const raw = (input || 'Assets/StreamingAssets/scene-config.json').replaceAll('\\', '/').trim();
  if (!raw || raw.startsWith('/') || raw.includes('..')) {
    throw new Error('Invalid unityConfigPath');
  }
  return raw;
}

function buildUnityConfigCandidates(input?: string): string[] {
  const raw = normalizeUnityConfigPath(input);
  const candidates: string[] = [];
  const push = (p: string) => {
    if (p && !candidates.includes(p)) candidates.push(p);
  };

  push(raw);

  if (raw.startsWith('Assets/StreamingAssets/')) {
    const tail = raw.slice('Assets/StreamingAssets/'.length);
    push(`assets/bin/Data/StreamingAssets/${tail}`);
    push(`assets/StreamingAssets/${tail}`);
    push(`assets/${tail}`);
    return candidates;
  }
  if (raw === 'Assets/StreamingAssets') {
    push('assets/bin/Data/StreamingAssets');
    push('assets/StreamingAssets');
    push('assets');
    return candidates;
  }

  if (raw.startsWith('StreamingAssets/')) {
    const tail = raw.slice('StreamingAssets/'.length);
    push(`assets/bin/Data/StreamingAssets/${tail}`);
    push(`assets/StreamingAssets/${tail}`);
    push(`assets/${tail}`);
    return candidates;
  }

  if (raw.startsWith('assets/')) {
    push(`assets/bin/Data/StreamingAssets/${raw.slice('assets/'.length)}`);
  }

  return candidates;
}

export async function resolveUnityConfigPath(decodedDir: string, input?: string): Promise<string> {
  const candidates = buildUnityConfigCandidates(input);
  for (const rel of candidates) {
    const abs = path.join(decodedDir, rel);
    if (await fse.pathExists(abs)) {
      return rel;
    }
  }
  throw new Error(`Unity config not found. Tried: ${candidates.join(', ')}`);
}

function setByPath(target: Record<string, unknown>, dotPath: string, value: unknown): void {
  const keys = dotPath
    .split('.')
    .map((k) => k.trim())
    .filter(Boolean);
  if (!keys.length) {
    throw new Error(`Invalid unity patch path: ${dotPath}`);
  }

  let node: unknown = target;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (typeof node !== 'object' || node === null) {
      throw new Error(`Invalid unity patch path: ${dotPath}`);
    }
    const bag = node as Record<string, unknown>;
    if (typeof bag[key] !== 'object' || bag[key] === null || Array.isArray(bag[key])) {
      bag[key] = {};
    }
    node = bag[key];
  }

  const last = keys[keys.length - 1];
  if (typeof node !== 'object' || node === null) {
    throw new Error(`Invalid unity patch path: ${dotPath}`);
  }
  (node as Record<string, unknown>)[last] = value;
}

export function parseUnityPatchesInput(raw: unknown): UnityPatch[] {
  if (!raw) {
    return [];
  }
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('unityPatches must be valid JSON');
    }
  }
  if (!Array.isArray(parsed)) {
    throw new Error('unityPatches must be an array');
  }
  return parsed.map((item, idx) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`unityPatches[${idx}] must be an object`);
    }
    const p = String((item as { path?: unknown }).path || '').trim();
    if (!p) {
      throw new Error(`unityPatches[${idx}].path is required`);
    }
    return {
      path: p,
      value: (item as { value?: unknown }).value
    };
  });
}

export async function applyUnityPatches(task: Task, payload: ModPayload): Promise<void> {
  const patches = payload.unityPatches || [];
  if (!patches.length) {
    return;
  }
  if (!task.decodedDir) {
    throw new Error('Decoded directory is missing');
  }

  const resolvedPath = await resolveUnityConfigPath(task.decodedDir, payload.unityConfigPath);
  const targetPath = path.join(task.decodedDir, resolvedPath);

  const text = await fse.readFile(targetPath, 'utf8');
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Unity config is not valid JSON: ${resolvedPath}`);
  }

  for (const patch of patches) {
    setByPath(json, patch.path, patch.value);
    logTask(task, `Unity param updated: ${patch.path}=${JSON.stringify(patch.value)}`);
  }

  await fse.writeFile(targetPath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
}

export async function readUnityConfig(task: Task, reqPath?: string): Promise<{ path: string; content: unknown }> {
  if (!task.decodedDir || !fse.existsSync(task.decodedDir)) {
    throw new Error('Task is not ready, decompile first');
  }

  const relPath = await resolveUnityConfigPath(task.decodedDir, reqPath);
  const filePath = path.join(task.decodedDir, relPath);
  const text = await fse.readFile(filePath, 'utf8');

  try {
    const content = JSON.parse(text);
    return { path: relPath, content };
  } catch {
    throw new Error(`Unity config is not valid JSON: ${relPath}`);
  }
}
