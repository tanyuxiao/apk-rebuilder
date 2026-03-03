import fse from 'fs-extra';
import path from 'node:path';
import type { ModPayload, Task } from '../models/task.js';
import { isValidPackageName, isValidVersionCode } from '../utils/validators.js';
import { logTask } from './task-store.js';

function escapeXmlAttr(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function readAttr(tag: string, attr: string): string {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(new RegExp(`${escaped}="([^"]*)"`));
  return match?.[1] ?? '';
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeResourceString(input: string): string {
  return input
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

async function resolveStringLabel(decodedDir: string, labelRef: string): Promise<string> {
  if (!labelRef.startsWith('@string/')) {
    return labelRef;
  }
  const name = labelRef.replace('@string/', '').trim();
  if (!name) {
    return labelRef;
  }

  const valuesDirs = ['values', ...(await fse.readdir(path.join(decodedDir, 'res')).catch(() => []))]
    .filter((dir, i, arr) => dir.startsWith('values') && arr.indexOf(dir) === i);

  for (const valuesDir of valuesDirs) {
    const stringsPath = path.join(decodedDir, 'res', valuesDir, 'strings.xml');
    if (!(await fse.pathExists(stringsPath))) {
      continue;
    }
    const content = await fse.readFile(stringsPath, 'utf8');
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = content.match(new RegExp(`<string\\s+name="${escaped}"[^>]*>([\\s\\S]*?)<\\/string>`));
    if (match?.[1]) {
      return decodeResourceString(match[1].trim());
    }
  }

  return labelRef;
}

async function readVersionFromApktoolYml(decodedDir: string): Promise<{ versionName: string; versionCode: string }> {
  const ymlPath = path.join(decodedDir, 'apktool.yml');
  if (!(await fse.pathExists(ymlPath))) {
    return { versionName: '', versionCode: '' };
  }
  const text = await fse.readFile(ymlPath, 'utf8');
  const versionName =
    text.match(/^\s*versionName:\s*['"]?([^\r\n'"]+)['"]?\s*$/m)?.[1]?.trim() ||
    text.match(/^\s*versionName:\s*([^\r\n]+)\s*$/m)?.[1]?.replace(/['"]/g, '').trim() ||
    '';
  const versionCode =
    text.match(/^\s*versionCode:\s*['"]?([^\r\n'"]+)['"]?\s*$/m)?.[1]?.trim() ||
    text.match(/^\s*versionCode:\s*([^\r\n]+)\s*$/m)?.[1]?.replace(/['"]/g, '').trim() ||
    '';
  return { versionName, versionCode };
}

async function resolveIconFile(decodedDir: string, iconRef: string): Promise<string | undefined> {
  if (!iconRef.startsWith('@')) {
    return undefined;
  }
  const clean = iconRef.replace(/^@/, '');
  const [resType, resName] = clean.split('/');
  if (!resType || !resName) {
    return undefined;
  }

  const resRoot = path.join(decodedDir, 'res');
  if (!(await fse.pathExists(resRoot))) {
    return undefined;
  }

  const densityRank = ['xxxhdpi', 'xxhdpi', 'xhdpi', 'hdpi', 'mdpi', 'anydpi'];
  const dirs = (await fse.readdir(resRoot)).filter((d) => d === resType || d.startsWith(`${resType}-`));
  const files: string[] = [];

  for (const dir of dirs) {
    const dirPath = path.join(resRoot, dir);
    const children = await fse.readdir(dirPath).catch(() => []);
    for (const child of children) {
      const parsed = path.parse(child);
      if (parsed.name === resName && ['.png', '.webp', '.jpg', '.jpeg'].includes(parsed.ext.toLowerCase())) {
        files.push(path.join(dirPath, child));
      }
    }
  }

  if (!files.length) {
    return undefined;
  }

  files.sort((a, b) => {
    const da = path.basename(path.dirname(a));
    const db = path.basename(path.dirname(b));
    const score = (dir: string) => {
      const hit = densityRank.findIndex((k) => dir.includes(k));
      return hit === -1 ? densityRank.length : hit;
    };
    return score(da) - score(db);
  });

  return files[0];
}

export async function parseApkInfo(task: Task): Promise<void> {
  if (!task.decodedDir) {
    return;
  }
  const manifestPath = path.join(task.decodedDir, 'AndroidManifest.xml');
  if (!(await fse.pathExists(manifestPath))) {
    return;
  }

  const xml = await fse.readFile(manifestPath, 'utf8');
  const manifestTag = xml.match(/<manifest\b[^>]*>/)?.[0] || '';
  const appTag = xml.match(/<application\b[^>]*>/)?.[0] || '';

  const packageName = readAttr(manifestTag, 'package');
  let versionName = readAttr(manifestTag, 'android:versionName');
  let versionCode = readAttr(manifestTag, 'android:versionCode');
  const appLabelRaw = readAttr(appTag, 'android:label');
  const iconRef = readAttr(appTag, 'android:icon');
  const appName = await resolveStringLabel(task.decodedDir, appLabelRaw || packageName || '');
  const iconFilePath = await resolveIconFile(task.decodedDir, iconRef);
  if (!versionName || !versionCode) {
    const fallback = await readVersionFromApktoolYml(task.decodedDir);
    versionName = versionName || fallback.versionName;
    versionCode = versionCode || fallback.versionCode;
  }

  task.iconFilePath = iconFilePath;
  task.apkInfo = {
    appName,
    packageName,
    versionName,
    versionCode,
    appLabelRaw,
    iconRef,
    iconUrl: iconFilePath ? `/api/icon/${task.id}?v=${Date.now()}` : undefined
  };
}

export async function applyIconReplacement(task: Task, iconUploadPath: string, ext: string): Promise<string> {
  if (!task.decodedDir) {
    throw new Error('Decoded directory is missing');
  }
  const resRoot = path.join(task.decodedDir, 'res');
  await fse.ensureDir(resRoot);

  const targetName = 'ic_launcher_modder';
  let mipmapDirs = (await fse.readdir(resRoot).catch(() => [])).filter((dir) => dir.startsWith('mipmap'));
  if (!mipmapDirs.length) {
    mipmapDirs = ['mipmap-mdpi', 'mipmap-hdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi'];
  }

  for (const dir of mipmapDirs) {
    const dirPath = path.join(resRoot, dir);
    await fse.ensureDir(dirPath);
    await fse.copy(iconUploadPath, path.join(dirPath, `${targetName}${ext}`), { overwrite: true });
  }

  logTask(task, `Icon files updated in ${mipmapDirs.length} mipmap folders`);
  return `@mipmap/${targetName}`;
}

export async function updateManifest(task: Task, payload: ModPayload, iconRef?: string): Promise<void> {
  if (!task.decodedDir) {
    throw new Error('Decoded directory is missing');
  }
  const manifestPath = path.join(task.decodedDir, 'AndroidManifest.xml');
  if (!(await fse.pathExists(manifestPath))) {
    throw new Error('AndroidManifest.xml not found after decompile');
  }

  let xml = await fse.readFile(manifestPath, 'utf8');
  const currentPackageName = readAttr(xml.match(/<manifest\b[^>]*>/)?.[0] || '', 'package');

  if (payload.packageName) {
    const packageName = payload.packageName.trim();
    if (!isValidPackageName(packageName)) {
      throw new Error('Invalid package name format');
    }
    if (/\bpackage="[^"]*"/.test(xml)) {
      xml = xml.replace(/\bpackage="[^"]*"/, `package="${escapeXmlAttr(packageName)}"`);
    } else if (/<manifest\b[^>]*>/.test(xml)) {
      xml = xml.replace(/<manifest\b([^>]*)>/, `<manifest$1 package="${escapeXmlAttr(packageName)}">`);
    }
    logTask(task, `Manifest updated: packageName=${packageName}`);

    if (currentPackageName && currentPackageName !== packageName) {
      const oldPrefix = `${currentPackageName}.`;
      const newPrefix = `${packageName}.`;
      const prefixRegex = new RegExp(escapeRegex(oldPrefix), 'g');
      xml = xml.replace(prefixRegex, newPrefix);

      const exactRegex = new RegExp(`([=\"'])${escapeRegex(currentPackageName)}([\"'])`, 'g');
      xml = xml.replace(exactRegex, `$1${packageName}$2`);
      logTask(task, `Manifest updated: renamed package-scoped refs ${currentPackageName} -> ${packageName}`);
    }
  }

  if (payload.versionName) {
    const versionName = escapeXmlAttr(payload.versionName.trim());
    if (/android:versionName="[^"]*"/.test(xml)) {
      xml = xml.replace(/android:versionName="[^"]*"/, `android:versionName="${versionName}"`);
    } else if (/<manifest\b[^>]*>/.test(xml)) {
      xml = xml.replace(/<manifest\b([^>]*)>/, `<manifest$1 android:versionName="${versionName}">`);
    }
    logTask(task, `Manifest updated: versionName=${payload.versionName}`);
  }

  if (payload.versionCode) {
    const versionCode = payload.versionCode.trim();
    if (!isValidVersionCode(versionCode)) {
      throw new Error('versionCode must be a non-negative integer');
    }
    if (/android:versionCode="[^"]*"/.test(xml)) {
      xml = xml.replace(/android:versionCode="[^"]*"/, `android:versionCode="${versionCode}"`);
    } else if (/<manifest\b[^>]*>/.test(xml)) {
      xml = xml.replace(/<manifest\b([^>]*)>/, `<manifest$1 android:versionCode="${versionCode}">`);
    }
    logTask(task, `Manifest updated: versionCode=${versionCode}`);
  }

  if (payload.appName) {
    const appName = escapeXmlAttr(payload.appName.trim());
    if (/android:label="[^"]*"/.test(xml)) {
      xml = xml.replace(/android:label="[^"]*"/, `android:label="${appName}"`);
    } else if (/<application\b[^>]*>/.test(xml)) {
      xml = xml.replace(/<application\b([^>]*)>/, `<application$1 android:label="${appName}">`);
    } else {
      throw new Error('No <application> tag found in AndroidManifest.xml');
    }
    logTask(task, `Manifest updated: appName=${payload.appName}`);
  }

  if (iconRef) {
    const safeIcon = escapeXmlAttr(iconRef);
    if (/android:icon="[^"]*"/.test(xml)) {
      xml = xml.replace(/android:icon="[^"]*"/, `android:icon="${safeIcon}"`);
    } else if (/<application\b[^>]*>/.test(xml)) {
      xml = xml.replace(/<application\b([^>]*)>/, `<application$1 android:icon="${safeIcon}">`);
    }

    if (/android:roundIcon="[^"]*"/.test(xml)) {
      xml = xml.replace(/android:roundIcon="[^"]*"/, `android:roundIcon="${safeIcon}"`);
    }
    logTask(task, `Manifest updated: iconRef=${iconRef}`);
  }

  await fse.writeFile(manifestPath, xml, 'utf8');
}
