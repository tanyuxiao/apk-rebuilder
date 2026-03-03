import fse from 'fs-extra';
import path from 'node:path';
import { apktoolPath, apksignerPath, debugAlias, debugKeystorePath, debugPass, javaPath, keytoolPath, zipalignPath } from '../config/env.js';
import type { ModPayload, Task } from '../models/task.js';
import { parseApkInfo, applyIconReplacement, updateManifest } from './manifest-service.js';
import { applyUnityPatches } from './unity-config-service.js';
import { runCommand } from './toolchain-service.js';
import { logTask, setTaskError } from './task-store.js';

async function ensureDebugKeystore(task: Task): Promise<void> {
  if (await fse.pathExists(debugKeystorePath)) {
    return;
  }
  logTask(task, 'Create debug keystore');
  await runCommand(keytoolPath, [
    '-genkeypair',
    '-v',
    '-keystore',
    debugKeystorePath,
    '-storepass',
    debugPass,
    '-alias',
    debugAlias,
    '-keypass',
    debugPass,
    '-keyalg',
    'RSA',
    '-keysize',
    '2048',
    '-validity',
    '10000',
    '-dname',
    'CN=Android Debug,O=Android,C=US'
  ]);
}

export async function runDecompileTask(task: Task): Promise<void> {
  task.status = 'processing';
  task.error = undefined;
  logTask(task, 'Start apktool decompile');

  const outDir = path.join(task.workDir, 'decoded');
  task.decodedDir = outDir;
  await fse.ensureDir(task.workDir);

  try {
    const decodeArgs = ['d', '--no-src', '-f', task.filePath, '-o', outDir];
    if (apktoolPath.endsWith('.jar')) {
      await runCommand(javaPath, ['-jar', apktoolPath, ...decodeArgs]);
    } else {
      await runCommand(apktoolPath, decodeArgs);
    }

    await parseApkInfo(task);
    task.status = 'success';
    logTask(task, 'Decompile finished');
  } catch (error) {
    setTaskError(task, error, 'Decompile failed');
  }
}

export async function runModTask(task: Task, payload: ModPayload): Promise<void> {
  task.status = 'processing';
  task.error = undefined;
  logTask(task, 'Start mod workflow');

  try {
    let iconRef: string | undefined;
    if (payload.iconUploadPath) {
      const ext = path.extname(payload.iconUploadPath).toLowerCase() || '.png';
      iconRef = await applyIconReplacement(task, payload.iconUploadPath, ext);
    }
    await updateManifest(task, payload, iconRef);
    await applyUnityPatches(task, payload);
  } catch (error) {
    setTaskError(task, error, 'Manifest update failed');
    return;
  }

  try {
    const unsignedApkPath = path.join(task.workDir, 'unsigned.apk');
    const alignedApkPath = path.join(task.workDir, 'aligned.apk');
    const signedApkPath = path.join(task.workDir, 'signed.apk');
    task.unsignedApkPath = unsignedApkPath;
    task.alignedApkPath = alignedApkPath;
    task.signedApkPath = signedApkPath;

    if (!task.decodedDir) {
      throw new Error('Decoded directory is missing');
    }

    logTask(task, 'Build apk with apktool');
    if (apktoolPath.endsWith('.jar')) {
      await runCommand(javaPath, ['-jar', apktoolPath, 'b', task.decodedDir, '-o', unsignedApkPath]);
    } else {
      await runCommand(apktoolPath, ['b', task.decodedDir, '-o', unsignedApkPath]);
    }

    logTask(task, 'Run zipalign');
    await runCommand(zipalignPath, ['-f', '4', unsignedApkPath, alignedApkPath]);

    await ensureDebugKeystore(task);
    logTask(task, 'Sign apk');
    await runCommand(apksignerPath, [
      'sign',
      '--ks',
      debugKeystorePath,
      '--ks-key-alias',
      debugAlias,
      '--ks-pass',
      `pass:${debugPass}`,
      '--key-pass',
      `pass:${debugPass}`,
      '--out',
      signedApkPath,
      alignedApkPath
    ]);

    await parseApkInfo(task);
    task.status = 'success';
    logTask(task, 'Mod workflow finished');
  } catch (error) {
    setTaskError(task, error, 'Mod workflow failed');
  }
}
