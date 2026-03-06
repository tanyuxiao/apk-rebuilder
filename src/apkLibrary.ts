import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import {
  APK_LIBRARY_CACHE_ROOT,
  APK_LIBRARY_DIR,
  APK_LIBRARY_INDEX_PATH,
} from './config';
import { ApkInfo, ApkLibraryItem } from './types';
import { nowIso } from './taskStore';

function readItems(): ApkLibraryItem[] {
  try {
    const raw = JSON.parse(fs.readFileSync(APK_LIBRARY_INDEX_PATH, 'utf8'));
    return Array.isArray(raw) ? (raw as ApkLibraryItem[]) : [];
  } catch {
    return [];
  }
}

function writeItems(items: ApkLibraryItem[]): void {
  fs.writeFileSync(APK_LIBRARY_INDEX_PATH, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
}

function safeFilename(name: string): string {
  const cleaned = name.trim().replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ');
  return cleaned || 'uploaded.apk';
}

function sha256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function cacheDirForItem(item: ApkLibraryItem): string {
  return path.join(APK_LIBRARY_CACHE_ROOT, item.id);
}

export function listApkItems(): ApkLibraryItem[] {
  return readItems().sort((a, b) => (b.lastUsedAt || b.createdAt).localeCompare(a.lastUsedAt || a.createdAt));
}

export function getApkItem(itemId: string): ApkLibraryItem | undefined {
  return readItems().find(item => item.id === itemId);
}

export function addOrGetApkItem(originalName: string, data: Buffer): { item: ApkLibraryItem; created: boolean } {
  const items = readItems();
  const digest = sha256(data);
  const createdAt = nowIso();
  const displayName = safeFilename(originalName || 'uploaded.apk');

  for (const item of items) {
    if (item.sha256 === digest) {
      item.lastUsedAt = createdAt;
      item.name = displayName;
      writeItems(items);
      return { item, created: false };
    }
  }

  const fileId = randomUUID();
  const suffix = path.extname(displayName) || '.apk';
  const storedName = `${fileId}${suffix.toLowerCase()}`;
  const storePath = path.join(APK_LIBRARY_DIR, storedName);
  fs.writeFileSync(storePath, data);

  const item: ApkLibraryItem = {
    id: fileId,
    name: displayName,
    storedName,
    filePath: storePath,
    size: data.length,
    sha256: digest,
    createdAt,
    lastUsedAt: createdAt,
    parsedReady: false,
    decodeCachePath: null,
    apkInfo: null,
  };

  items.push(item);
  writeItems(items);
  return { item, created: true };
}

export function touchApkItem(itemId: string): ApkLibraryItem | undefined {
  const items = readItems();
  const item = items.find(entry => entry.id === itemId);
  if (!item) {
    return undefined;
  }
  item.lastUsedAt = nowIso();
  writeItems(items);
  return item;
}

export function updateParseCache(itemId: string, decodedDir: string, apkInfo: ApkInfo | null): ApkLibraryItem | undefined {
  if (!fs.existsSync(decodedDir)) {
    return undefined;
  }

  const items = readItems();
  const item = items.find(entry => entry.id === itemId);
  if (!item) {
    return undefined;
  }

  const cacheDir = path.join(cacheDirForItem(item), 'decoded');
  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(cacheDir), { recursive: true });
  fs.cpSync(decodedDir, cacheDir, { recursive: true });

  item.parsedReady = true;
  item.decodeCachePath = cacheDir;
  item.apkInfo = apkInfo;
  item.lastUsedAt = nowIso();
  writeItems(items);
  return item;
}

export function deleteApkItem(itemId: string): boolean {
  const items = readItems();
  const item = items.find(entry => entry.id === itemId);
  if (!item) {
    return false;
  }

  fs.rmSync(item.filePath, { force: true });
  fs.rmSync(cacheDirForItem(item), { recursive: true, force: true });
  writeItems(items.filter(entry => entry.id !== itemId));
  return true;
}
