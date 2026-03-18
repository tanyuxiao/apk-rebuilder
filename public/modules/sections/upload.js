export function renderUploadSection(container) {
  container.insertAdjacentHTML(
    'beforeend',
    `
    <div class="card" id="sectionUpload">
      <strong>上传 APK</strong>
      <div class="row">
        <input id="apkFile" type="file" accept=".apk,application/vnd.android.package-archive" style="display:none" />
        <div id="dropzone" class="dropzone">拖拽 APK 到这里，或点击选择文件后自动解析</div>
      </div>
      <div class="row">
        <span class="muted">任务ID: <code id="taskId">-</code></span>
        <span class="muted">状态: <span id="taskStatus">idle</span></span>
      </div>
    </div>
    `
  );
}

export function bindUploadSection({ onUpload, onStageChange }) {
  const dropzone = document.getElementById('dropzone');
  const apkFile = document.getElementById('apkFile');

  if (!dropzone || !apkFile) return;

  dropzone.addEventListener('click', () => apkFile.click());
  apkFile.addEventListener('change', () => {
    const file = apkFile.files?.[0];
    if (file) onUpload(file);
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'dragend'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) onUpload(file);
  });

  if (onStageChange) onStageChange();
}

export function setUploadBusy(isBusy) {
  const drop = document.getElementById('dropzone');
  const apkFile = document.getElementById('apkFile');
  if (!drop || !apkFile) return;
  drop.classList.toggle('loading', Boolean(isBusy));
  drop.textContent = isBusy ? '上传并解析中，请稍候...' : '拖拽 APK 到这里，或点击选择文件后自动解析';
  drop.style.pointerEvents = isBusy ? 'none' : 'auto';
  apkFile.disabled = Boolean(isBusy);
}
