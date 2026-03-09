import fs from 'fs';
import path from 'path';
import {
  APKTOOL_PATH,
  APKSIGNER_PATH,
  DEBUG_ALIAS,
  DEBUG_KEYSTORE_PATH,
  DEBUG_PASS,
  JAVA_PATH,
  KEYTOOL_PATH,
  ZIPALIGN_PATH,
} from './config';
import { updateParseCache } from './apkLibrary';
import { applyFilePatches } from './filePatchService';
import { applyIconReplacement, parseApkInfo, updateManifest } from './manifestService';
import { logTask, setTaskError, updateTask } from './taskStore';
import { ModPayload, Task } from './types';
import { runCommand } from './toolchain';
import { applyUnityPatches } from './unityConfigService';

function ensureDebugKeystore(task: Task): void {
  if (fs.existsSync(DEBUG_KEYSTORE_PATH)) {
    return;
  }
  logTask(task, 'Create debug keystore');
  runCommand(KEYTOOL_PATH, [
    '-genkeypair',
    '-v',
    '-keystore',
    DEBUG_KEYSTORE_PATH,
    '-storepass',
    DEBUG_PASS,
    '-alias',
    DEBUG_ALIAS,
    '-keypass',
    DEBUG_PASS,
    '-keyalg',
    'RSA',
    '-keysize',
    '2048',
    '-validity',
    '10000',
    '-dname',
    'CN=Android Debug,O=Android,C=US',
  ]);
}

function runApktool(args: string[]): void {
  if (APKTOOL_PATH.endsWith('.jar')) {
    runCommand(JAVA_PATH, ['-jar', APKTOOL_PATH, ...args]);
    return;
  }
  runCommand(APKTOOL_PATH, args);
}

function tryZipalign(task: Task, unsignedApkPath: string, alignedApkPath: string): void {
  logTask(task, 'Run zipalign');
  try {
    runCommand(ZIPALIGN_PATH, ['-f', '4', unsignedApkPath, alignedApkPath]);
  } catch (error) {
    logTask(task, `zipalign unavailable, fallback to unaligned signing: ${String(error)}`);
    fs.copyFileSync(unsignedApkPath, alignedApkPath);
  }
}

export async function runDecompileTask(task: Task): Promise<void> {
  task.status = 'processing';
  task.error = null;
  task.errorCode = null;
  logTask(task, 'Start apktool decompile');

  const outDir = path.join(task.workDir, 'decoded');
  task.decodedDir = outDir;
  fs.mkdirSync(task.workDir, { recursive: true });
  updateTask(task);

  try {
    runApktool(['d', '--no-src', '-f', task.filePath, '-o', outDir]);
    parseApkInfo(task);
    if (task.libraryItemId && task.apkInfo) {
      updateParseCache(task.libraryItemId, outDir, task.apkInfo);
    }
    task.status = 'success';
    logTask(task, 'Decompile finished');
  } catch (error) {
    setTaskError(task, error, 'Decompile failed', 'APK_DECOMPILE_FAILED');
  }
}

export async function runModTask(task: Task, payload: ModPayload): Promise<void> {
  task.status = 'processing';
  task.error = null;
  task.errorCode = null;
  logTask(task, 'Start mod workflow');

  try {
    let iconRef: string | undefined;
    if (payload.iconUploadPath) {
      iconRef = applyIconReplacement(task, payload.iconUploadPath, path.extname(payload.iconUploadPath).toLowerCase() || '.png');
    }
    updateManifest(task, payload, iconRef);
    applyUnityPatches(task, payload);
    applyFilePatches(task, payload);
  } catch (error) {
    setTaskError(task, error, 'Manifest update failed', 'APK_MOD_FAILED');
    return;
  }

  try {
    const unsignedApkPath = path.join(task.workDir, 'unsigned.apk');
    const alignedApkPath = path.join(task.workDir, 'aligned.apk');
    const signedApkPath = path.join(task.workDir, 'signed.apk');
    task.unsignedApkPath = unsignedApkPath;
    task.alignedApkPath = alignedApkPath;
    task.signedApkPath = signedApkPath;
    updateTask(task);

    if (!task.decodedDir) {
      throw new Error('Decoded directory is missing');
    }

    logTask(task, 'Build apk with apktool');
    runApktool(['b', task.decodedDir, '-o', unsignedApkPath]);
    tryZipalign(task, unsignedApkPath, alignedApkPath);

    ensureDebugKeystore(task);
    logTask(task, 'Sign apk');
    runCommand(APKSIGNER_PATH, [
      'sign',
      '--ks',
      DEBUG_KEYSTORE_PATH,
      '--ks-key-alias',
      DEBUG_ALIAS,
      '--ks-pass',
      `pass:${DEBUG_PASS}`,
      '--key-pass',
      `pass:${DEBUG_PASS}`,
      '--out',
      signedApkPath,
      alignedApkPath,
    ]);

    parseApkInfo(task);
    task.status = 'success';
    logTask(task, 'Mod workflow finished');
  } catch (error) {
    setTaskError(task, error, 'Mod workflow failed', 'APK_BUILD_FAILED');
  }
}
