export type TaskStatus = 'queued' | 'processing' | 'success' | 'failed';

export type ApkInfo = {
  appName: string;
  packageName: string;
  versionName: string;
  versionCode: string;
  appLabelRaw: string;
  iconRef: string;
  iconUrl?: string;
};

export type Task = {
  id: string;
  status: TaskStatus;
  filePath: string;
  workDir: string;
  createdAt: string;
  updatedAt: string;
  logs: string[];
  error?: string;
  decodedDir?: string;
  unsignedApkPath?: string;
  alignedApkPath?: string;
  signedApkPath?: string;
  iconFilePath?: string;
  apkInfo?: ApkInfo;
};

export type UnityPatch = {
  path: string;
  value: unknown;
};

export type ModPayload = {
  appName?: string;
  packageName?: string;
  versionName?: string;
  versionCode?: string;
  iconUploadPath?: string;
  unityConfigPath?: string;
  unityPatches?: UnityPatch[];
};
