<script setup lang="ts">
import type { UploadFile } from 'element-plus';
import { storeToRefs } from 'pinia';
import axios from 'axios';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useTaskStore } from './stores/task';

const taskStore = useTaskStore();
const {
  canUpload,
  canMod,
  processingStage,
  uploading,
  currentTaskId,
  status,
  logs,
  errorMessage,
  appName,
  packageName,
  versionName,
  versionCode,
  unityConfigPath,
  unityEntries,
  loadingUnityConfig,
  modding,
  downloadReady,
  apkInfo,
  iconFile
} = storeToRefs(taskStore);

const toolsLoading = ref(false);
const toolsError = ref('');
const tools = ref<Record<string, { ok: boolean; command: string; detail: string }>>({});

const iconEditorVisible = ref(false);
const iconEditorScale = ref(1);
const iconEditorOffsetX = ref(0);
const iconEditorOffsetY = ref(0);
const iconEditorDataUrl = ref('');
const iconEditorName = ref('icon.png');
const iconPreviewCanvas = ref<HTMLCanvasElement>();
const sourceImage = new Image();
sourceImage.onload = () => {
  renderIconPreview();
};

async function refreshTools(): Promise<void> {
  toolsLoading.value = true;
  toolsError.value = '';
  try {
    const { data } = await axios.get('/api/tools');
    const payload =
      data && typeof data === 'object' && 'success' in data && data.success === true && 'data' in data ? data.data : data;
    tools.value = payload?.tools ?? {};
  } catch (error) {
    if (axios.isAxiosError<{ message?: string; error?: { message?: string } }>(error)) {
      toolsError.value = error.response?.data?.error?.message || error.response?.data?.message || error.message;
    } else {
      toolsError.value = error instanceof Error ? error.message : String(error);
    }
  } finally {
    toolsLoading.value = false;
  }
}

function onIconChange(file: UploadFile): void {
  if (!file.raw) return;
  const reader = new FileReader();
  reader.onload = () => {
    iconEditorDataUrl.value = String(reader.result || '');
    iconEditorName.value = file.raw?.name || 'icon.png';
    iconEditorScale.value = 1;
    iconEditorOffsetX.value = 0;
    iconEditorOffsetY.value = 0;
    sourceImage.src = iconEditorDataUrl.value;
    iconEditorVisible.value = true;
  };
  reader.readAsDataURL(file.raw);
}

function renderIconPreview(): void {
  const canvas = iconPreviewCanvas.value;
  if (!canvas || !sourceImage.width || !sourceImage.height) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const size = canvas.width;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#f3f4f6';
  ctx.fillRect(0, 0, size, size);

  const baseScale = Math.max(size / sourceImage.width, size / sourceImage.height);
  const scale = baseScale * iconEditorScale.value;
  const drawW = sourceImage.width * scale;
  const drawH = sourceImage.height * scale;
  const drawX = (size - drawW) / 2 + iconEditorOffsetX.value;
  const drawY = (size - drawH) / 2 + iconEditorOffsetY.value;
  ctx.drawImage(sourceImage, drawX, drawY, drawW, drawH);
}

async function applyEditedIcon(): Promise<void> {
  const canvas = iconPreviewCanvas.value;
  if (!canvas) return;
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/png');
  });
  if (!blob) return;
  const safeName = iconEditorName.value.replace(/\.[^.]+$/, '') || 'icon';
  const file = new File([blob], `${safeName}-edited.png`, { type: 'image/png' });
  taskStore.setIconFile(file);
  iconEditorVisible.value = false;
}

onMounted(() => {
  void refreshTools();
});

const uploadLoadingActive = computed(() => uploading.value || status.value === 'processing');
const uploadLoadingText = computed(() =>
  processingStage.value === 'mod' ? 'APK修改并构建中...' : 'APK 上传与解析中...'
);

watch([iconEditorScale, iconEditorOffsetX, iconEditorOffsetY, iconEditorVisible], () => {
  if (iconEditorVisible.value) {
    renderIconPreview();
  }
});

onBeforeUnmount(() => {
  taskStore.stopPolling();
});
</script>

<template>
  <main class="page">
    <el-card class="card">
      <template #header>
        <div class="header">
          <h1>APK Modder</h1>
          <span v-if="status" class="status">状态：{{ status }}</span>
        </div>
      </template>

      <div class="tooling mt">
        <div class="tooling-head">
          <strong>工具链自检</strong>
          <el-button size="small" text :loading="toolsLoading" @click="refreshTools">刷新</el-button>
        </div>
        <el-alert v-if="toolsError" type="warning" :closable="false" :title="toolsError" />
        <div class="tool-list" v-else>
          <div v-for="(tool, name) in tools" :key="name" class="tool-item">
            <el-tag :type="tool.ok ? 'success' : 'danger'" size="small">{{ tool.ok ? 'OK' : 'FAIL' }}</el-tag>
            <span class="tool-name">{{ name }}</span>
            <code>{{ tool.command }}</code>
          </div>
        </div>
      </div>

      <div
        v-loading="uploadLoadingActive"
        :element-loading-text="uploadLoadingText"
      >
        <el-upload
          drag
          :auto-upload="false"
          :show-file-list="false"
          accept=".apk"
          :on-change="(rawFile: UploadFile) => rawFile.raw && taskStore.uploadApk(rawFile.raw)"
          :disabled="!canUpload"
        >
          <div class="upload-title">拖拽 APK 到这里，或点击选择</div>
          <div class="upload-hint">上传后会先解析并展示当前图标、应用名、包名、版本名与版本号</div>
        </el-upload>
      </div>

      <div class="meta" v-if="currentTaskId">
        任务 ID: <code>{{ currentTaskId }}</code>
      </div>

      <div class="apk-info mt" v-if="apkInfo">
        <div class="apk-icon">
          <img v-if="apkInfo.iconUrl" :src="apkInfo.iconUrl" alt="apk icon" />
          <div v-else class="icon-fallback">无图标</div>
        </div>
        <div class="apk-fields">
          <div><strong>当前应用名：</strong>{{ apkInfo.appName || '-' }}</div>
          <div><strong>当前标识符：</strong><code>{{ apkInfo.packageName || '-' }}</code></div>
          <div>
            <strong>当前版本：</strong>
            {{ apkInfo.versionName || '-' }}
            <span class="ver-code">({{ apkInfo.versionCode || '-' }})</span>
          </div>
        </div>
      </div>

      <div class="mod-form mt" v-if="currentTaskId">
        <el-input v-model="appName" placeholder="新应用名（可改）" clearable />
        <el-input v-model="packageName" placeholder="新标识符/包名（可改）" clearable />
        <el-input v-model="versionName" placeholder="新版本名（例如 1.0.0）" clearable />
        <el-input v-model="versionCode" placeholder="新版本号（例如 100，对应(100)）" clearable />
        <el-upload
          :auto-upload="false"
          :show-file-list="true"
          :limit="1"
          accept=".png,.webp,.jpg,.jpeg,image/png,image/webp,image/jpeg"
          :on-change="onIconChange"
        >
          <el-button>选择新图标（png/webp/jpg）</el-button>
        </el-upload>
        <div class="icon-name" v-if="iconFile">图标：{{ iconFile.name }}</div>
        <div class="unity-block">
          <div class="unity-head">
            <strong>Unity 可变参数</strong>
            <el-button size="small" text :loading="loadingUnityConfig" @click="taskStore.loadUnityConfig">重新读取</el-button>
          </div>
          <el-input v-model="unityConfigPath" placeholder="Unity 配置文件路径（默认 Assets/StreamingAssets/scene-config.json）" />
          <div class="unity-hint">只展示并编辑 JSON 里已有参数；参数名与类型只读，不支持新增参数。</div>
          <div v-for="item in unityEntries" :key="item.path" class="unity-row">
            <el-input :model-value="item.path" readonly />
            <el-input :model-value="item.valueType" readonly />
            <el-input
              v-model="item.valueText"
              :placeholder="item.valueType === 'json' ? 'JSON 值' : '参数值'"
            />
          </div>
          <el-empty v-if="!unityEntries.length" description="上传解析完成后会自动显示可编辑参数" :image-size="56" />
        </div>
        <el-button type="primary" :disabled="!canMod" :loading="modding" @click="taskStore.startModBuild">
          修改并构建
        </el-button>
        <el-button
          v-if="downloadReady"
          type="success"
          plain
          :href="`/api/download/${currentTaskId}`"
          tag="a"
        >
          下载 APK
        </el-button>
      </div>

      <el-alert
        v-if="errorMessage"
        class="mt"
        type="error"
        :closable="false"
        :title="errorMessage"
      />

      <el-scrollbar height="300px" class="logs mt">
        <pre>{{ logs.join('\n') || '暂无日志' }}</pre>
      </el-scrollbar>
    </el-card>

    <el-dialog v-model="iconEditorVisible" title="编辑图标" width="560px">
      <div class="icon-editor">
        <canvas ref="iconPreviewCanvas" width="256" height="256" class="icon-canvas" />
        <div class="icon-controls">
          <div>缩放</div>
          <el-slider v-model="iconEditorScale" :min="0.5" :max="2.5" :step="0.01" />
          <div>水平偏移</div>
          <el-slider v-model="iconEditorOffsetX" :min="-120" :max="120" :step="1" />
          <div>垂直偏移</div>
          <el-slider v-model="iconEditorOffsetY" :min="-120" :max="120" :step="1" />
        </div>
      </div>
      <template #footer>
        <el-button @click="iconEditorVisible = false">取消</el-button>
        <el-button type="primary" @click="applyEditedIcon">应用图标</el-button>
      </template>
    </el-dialog>
  </main>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 24px;
  background: #f5f7fa;
}

.card {
  max-width: 980px;
  margin: 0 auto;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header h1 {
  margin: 0;
  font-size: 20px;
}

.status {
  color: #606266;
  font-size: 14px;
}

.upload-title {
  font-size: 16px;
  color: #303133;
}

.upload-hint {
  margin-top: 8px;
  color: #909399;
  font-size: 13px;
}

.meta {
  margin-top: 14px;
  color: #606266;
}

.apk-info {
  display: grid;
  grid-template-columns: 80px 1fr;
  gap: 14px;
  align-items: center;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 12px;
  background: #fff;
}

.apk-icon img,
.icon-fallback {
  width: 72px;
  height: 72px;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  object-fit: cover;
  display: grid;
  place-items: center;
  color: #909399;
  font-size: 12px;
}

.apk-fields {
  display: grid;
  gap: 6px;
  font-size: 14px;
  color: #303133;
}

.ver-code {
  color: #909399;
}

.mod-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  align-items: center;
}

.icon-name {
  color: #606266;
  font-size: 13px;
}

.icon-editor {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 16px;
  align-items: start;
}

.icon-canvas {
  width: 256px;
  height: 256px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
}

.icon-controls {
  display: grid;
  gap: 8px;
}

.unity-block {
  grid-column: 1 / -1;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 10px;
  display: grid;
  gap: 8px;
}

.unity-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.unity-hint {
  color: #909399;
  font-size: 12px;
}

.unity-row {
  display: grid;
  grid-template-columns: 1.2fr 0.7fr 1fr;
  gap: 8px;
  align-items: center;
}

.tooling {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}

.tooling-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.tool-list {
  display: grid;
  gap: 8px;
}

.tool-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #606266;
}

.tool-name {
  width: 80px;
  color: #303133;
}

.logs {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fff;
}

.logs pre {
  margin: 0;
  padding: 12px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.mt {
  margin-top: 14px;
}

@media (max-width: 900px) {
  .mod-form {
    grid-template-columns: 1fr;
  }

  .apk-info {
    grid-template-columns: 1fr;
    justify-items: start;
  }

  .unity-row {
    grid-template-columns: 1fr;
  }

  .icon-editor {
    grid-template-columns: 1fr;
  }
}
</style>
