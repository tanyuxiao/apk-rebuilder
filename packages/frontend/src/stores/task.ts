import axios from 'axios';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

type TaskStatus = 'queued' | 'processing' | 'success' | 'failed';

type ApkInfo = {
  appName: string;
  packageName: string;
  versionName: string;
  versionCode: string;
  appLabelRaw: string;
  iconRef: string;
  iconUrl?: string;
};

type TaskResponse = {
  id: string;
  status: TaskStatus;
};

type StatusResponse = {
  id: string;
  status: TaskStatus;
  logs: string[];
  error?: string;
  downloadReady?: boolean;
  apkInfo?: ApkInfo;
};

type UnityValueType = 'string' | 'number' | 'boolean' | 'json';

type UnityConfigResponse = {
  path: string;
  content: unknown;
};

type UnityEntry = {
  path: string;
  valueType: UnityValueType;
  valueText: string;
  originalValueText: string;
};

type ApiSuccess<T> = { success: true; data: T };
type ApiError = { success: false; error: { message: string; code?: string; details?: unknown } };

function unwrapApi<T>(payload: T | ApiSuccess<T>): T {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'success' in payload &&
    (payload as { success?: unknown }).success === true &&
    'data' in payload
  ) {
    return (payload as ApiSuccess<T>).data;
  }
  return payload as T;
}

function toErrorMessage(error: unknown): string {
  if (axios.isAxiosError<{ message?: string; error?: { message?: string } }>(error)) {
    return error.response?.data?.error?.message || error.response?.data?.message || error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function inferUnityType(value: unknown): UnityValueType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value !== null && typeof value === 'object') return 'json';
  return 'string';
}

function toUnityText(valueType: UnityValueType, value: unknown): string {
  if (valueType === 'json') return JSON.stringify(value);
  if (valueType === 'string') return String(value ?? '');
  return String(value);
}

function flattenUnityObject(value: unknown, basePath = ''): UnityEntry[] {
  if (value === null || typeof value !== 'object') {
    const valueType = inferUnityType(value);
    const text = toUnityText(valueType, value);
    return [{ path: basePath || '$', valueType, valueText: text, originalValueText: text }];
  }

  if (Array.isArray(value)) {
    const type: UnityValueType = 'json';
    const text = JSON.stringify(value);
    return [{ path: basePath || '$', valueType: type, valueText: text, originalValueText: text }];
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const out: UnityEntry[] = [];
  for (const key of keys) {
    const nextPath = basePath ? `${basePath}.${key}` : key;
    const child = obj[key];
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      out.push(...flattenUnityObject(child, nextPath));
    } else {
      const valueType = inferUnityType(child);
      const text = toUnityText(valueType, child);
      out.push({ path: nextPath, valueType, valueText: text, originalValueText: text });
    }
  }
  return out;
}

export const useTaskStore = defineStore('task', () => {
  const processingStage = ref<'idle' | 'upload' | 'mod'>('idle');
  const uploading = ref(false);
  const modding = ref(false);
  const loadingUnityConfig = ref(false);
  const currentTaskId = ref('');
  const status = ref<TaskStatus | ''>('');
  const logs = ref<string[]>([]);
  const errorMessage = ref('');
  const downloadReady = ref(false);
  const apkInfo = ref<ApkInfo | null>(null);

  const appName = ref('');
  const packageName = ref('');
  const versionName = ref('');
  const versionCode = ref('');
  const iconFile = ref<File | null>(null);
  const unityConfigPath = ref('Assets/StreamingAssets/scene-config.json');
  const unityEntries = ref<UnityEntry[]>([]);
  const unityLoadedTaskId = ref('');

  let formInitialized = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const canUpload = computed(() => !uploading.value && status.value !== 'processing');
  const canMod = computed(() => {
    if (!currentTaskId.value || modding.value || status.value === 'processing') {
      return false;
    }
    const hasUnityChanges = unityEntries.value.some((e) => e.valueText !== e.originalValueText);
    return Boolean(
      appName.value || packageName.value || versionName.value || versionCode.value || iconFile.value || hasUnityChanges
    );
  });

  function resetForm(): void {
    appName.value = '';
    packageName.value = '';
    versionName.value = '';
    versionCode.value = '';
    iconFile.value = null;
    unityConfigPath.value = 'Assets/StreamingAssets/scene-config.json';
    unityEntries.value = [];
    unityLoadedTaskId.value = '';
    processingStage.value = 'idle';
    formInitialized = false;
  }

  function setIconFile(file: File | null): void {
    iconFile.value = file;
  }

  function stopPolling(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  async function fetchStatus(taskId: string): Promise<void> {
    const resp = await axios.get<StatusResponse | ApiSuccess<StatusResponse>>(`/api/status/${taskId}`);
    const data = unwrapApi<StatusResponse>(resp.data);
    status.value = data.status;
    logs.value = data.logs;
    errorMessage.value = data.error ?? '';
    downloadReady.value = Boolean(data.downloadReady);
    apkInfo.value = data.apkInfo ?? null;

    if (data.apkInfo && !formInitialized) {
      appName.value = data.apkInfo.appName || '';
      packageName.value = data.apkInfo.packageName || '';
      versionName.value = data.apkInfo.versionName || '';
      versionCode.value = data.apkInfo.versionCode || '';
      formInitialized = true;
    }

    if (data.status === 'success' || data.status === 'failed') {
      processingStage.value = 'idle';
      stopPolling();
    }

    if (data.status === 'success' && currentTaskId.value === taskId && unityLoadedTaskId.value !== taskId) {
      unityLoadedTaskId.value = taskId;
      void loadUnityConfig();
    }
  }

  async function loadUnityConfig(): Promise<void> {
    if (!currentTaskId.value) return;
    loadingUnityConfig.value = true;
    errorMessage.value = '';
    try {
      const resp = await axios.get<UnityConfigResponse | ApiSuccess<UnityConfigResponse>>(`/api/unity-config/${currentTaskId.value}`, {
        params: { path: unityConfigPath.value.trim() || 'Assets/StreamingAssets/scene-config.json' }
      });
      const data = unwrapApi<UnityConfigResponse>(resp.data);
      unityEntries.value = flattenUnityObject(data.content);
      unityLoadedTaskId.value = currentTaskId.value;
    } catch (error) {
      errorMessage.value = toErrorMessage(error);
      unityEntries.value = [];
    } finally {
      loadingUnityConfig.value = false;
    }
  }

  function parseUnityPatchValue(valueType: UnityValueType, valueText: string): unknown {
    const t = valueText.trim();
    if (valueType === 'string') return valueText;
    if (valueType === 'number') {
      const num = Number(t);
      if (Number.isNaN(num)) {
        throw new Error(`Unity 参数数值格式错误: ${valueText}`);
      }
      return num;
    }
    if (valueType === 'boolean') {
      if (t === 'true') return true;
      if (t === 'false') return false;
      throw new Error(`Unity 参数布尔值必须是 true 或 false: ${valueText}`);
    }
    try {
      return JSON.parse(t || 'null');
    } catch {
      throw new Error(`Unity 参数 JSON 格式错误: ${valueText}`);
    }
  }

  function buildUnityPatchesPayload(): { path: string; value: unknown }[] {
    return unityEntries.value
      .filter((item) => item.valueText !== item.originalValueText)
      .map((item) => ({
        path: item.path,
        value: parseUnityPatchValue(item.valueType, item.valueText)
      }));
  }

  function startPolling(taskId: string): void {
    stopPolling();
    timer = setInterval(() => {
      void fetchStatus(taskId);
    }, 1200);
  }

  async function uploadApk(file: File): Promise<void> {
    processingStage.value = 'upload';
    uploading.value = true;
    errorMessage.value = '';
    logs.value = [];
    status.value = '';
    currentTaskId.value = '';
    downloadReady.value = false;
    apkInfo.value = null;
    resetForm();

    try {
      const form = new FormData();
      form.append('apk', file);
      const resp = await axios.post<TaskResponse | ApiSuccess<TaskResponse>>('/api/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const data = unwrapApi<TaskResponse>(resp.data);
      currentTaskId.value = data.id;
      status.value = data.status;
      await fetchStatus(data.id);
      startPolling(data.id);
    } catch (error) {
      processingStage.value = 'idle';
      errorMessage.value = toErrorMessage(error);
    } finally {
      uploading.value = false;
    }
  }

  async function startModBuild(): Promise<void> {
    if (!currentTaskId.value) return;
    processingStage.value = 'mod';
    modding.value = true;
    errorMessage.value = '';
    downloadReady.value = false;

    try {
      const form = new FormData();
      form.append('id', currentTaskId.value);
      if (appName.value.trim()) form.append('appName', appName.value.trim());
      if (packageName.value.trim()) form.append('packageName', packageName.value.trim());
      if (versionName.value.trim()) form.append('versionName', versionName.value.trim());
      if (versionCode.value.trim()) form.append('versionCode', versionCode.value.trim());
      if (iconFile.value) form.append('icon', iconFile.value);
      if (unityConfigPath.value.trim()) form.append('unityConfigPath', unityConfigPath.value.trim());
      const patches = buildUnityPatchesPayload();
      if (patches.length) {
        form.append('unityPatches', JSON.stringify(patches));
      }

      await axios.post('/api/mod', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      status.value = 'processing';
      startPolling(currentTaskId.value);
    } catch (error) {
      processingStage.value = 'idle';
      errorMessage.value = toErrorMessage(error);
    } finally {
      modding.value = false;
    }
  }

  return {
    processingStage,
    uploading,
    modding,
    loadingUnityConfig,
    currentTaskId,
    status,
    logs,
    errorMessage,
    downloadReady,
    apkInfo,
    appName,
    packageName,
    versionName,
    versionCode,
    iconFile,
    unityConfigPath,
    unityEntries,
    canUpload,
    canMod,
    setIconFile,
    loadUnityConfig,
    fetchStatus,
    startPolling,
    stopPolling,
    uploadApk,
    startModBuild
  };
});
