import { formatBytes, fmtTime } from '../state.js';

export function renderStandardPackageSection(container) {
  container.insertAdjacentHTML(
    'beforeend',
    `
    <div class="card" id="sectionStandardPackage">
      <div class="toolbar">
        <strong>标准包管理</strong>
        <span id="standardPackageStatus" class="muted"></span>
      </div>
      <div class="row" style="margin-top:10px;">
        <input id="standardApkFile" type="file" accept=".apk,application/vnd.android.package-archive" style="display:none" />
        <button id="standardUploadBtn" class="secondary" type="button">上传标准包 APK</button>
        <span id="standardUploadName" class="muted">未选择文件</span>
      </div>
      <div id="standardPackageList" class="standard-package-list" style="margin-top:12px;"></div>
    </div>
    `
  );
}

export function createStandardPackageSection({ host }) {
  const state = {
    items: [],
    activeStandardId: null,
    previousStandardId: null,
    disabledIds: [],
  };

  function normalizeDisplayName(name) {
    if (!name) return '';
    const value = String(name);
    try {
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(
        Uint8Array.from(value, (c) => c.charCodeAt(0))
      );
      if (decoded && !decoded.includes('�')) return decoded;
    } catch {
      // ignore
    }
    return value;
  }

  function render() {
    const list = document.getElementById('standardPackageList');
    if (!list) return;
    if (!state.items.length) {
      list.innerHTML = '<div class="muted">暂无标准包记录，请先上传 APK</div>';
      return;
    }

    list.innerHTML = state.items
      .map((item) => {
        const rawName = item.name || item.storedName || item.id;
        const name = normalizeDisplayName(rawName);
        const isActive = state.activeStandardId === item.id;
        const badges = [];
        if (isActive) badges.push('<span class="tag ok">当前标准包</span>');
        if (state.previousStandardId === item.id) badges.push('<span class="tag warn">上一版本</span>');
        if (state.disabledIds.includes(item.id)) badges.push('<span class="tag fail">已禁用</span>');
        return `
          <div class="standard-package-item">
            <div class="standard-package-main">
              <div class="standard-package-title">${name}</div>
              <div class="standard-package-id">ID: ${item.id}</div>
              <div class="standard-package-meta">大小: ${formatBytes(Number(item.size || 0))}</div>
              <div class="standard-package-meta">上传时间: ${fmtTime(item.createdAt)}</div>
              <div class="standard-package-badges">${badges.join('')}</div>
            </div>
            <div class="standard-package-actions">
              <button class="secondary ${isActive ? 'is-active' : ''}" type="button" data-action="set-standard" data-id="${item.id}" ${isActive ? 'disabled' : ''}>
                ${isActive ? '已设为标准包' : '设为标准包'}
              </button>
              <button class="secondary" type="button" data-action="delete" data-id="${item.id}">删除</button>
            </div>
          </div>
        `;
      })
      .join('');
  }

  async function load() {
    const res = await host.authFetch('/plugin/admin/apk-library');
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message || '标准包列表获取失败');
    const data = json?.data || json;
    state.items = data.items || [];
    state.activeStandardId = data.standard?.activeStandardId || null;
    state.previousStandardId = data.standard?.previousStandardId || null;
    state.disabledIds = data.standard?.disabledIds || [];
    render();
  }

  async function setStandard(itemId) {
    const res = await host.authFetch('/plugin/admin/standard-package', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ standardLibraryItemId: itemId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || '标准包设置失败');
    await load();
  }

  async function deleteItem(itemId) {
    if (!confirm('确认删除该 APK 标准包吗？')) return;
    const res = await host.authFetch(`/plugin/admin/apk-library/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || '删除失败');
    await load();
  }

  async function uploadStandard(file) {
    if (!file) return;
    const fileName = String(file.name || '').toLowerCase();
    if (!fileName.endsWith('.apk')) {
      alert('仅支持 APK 文件');
      return;
    }
    const form = new FormData();
    form.append('apk', file);
    const res = await host.authFetch('/api/upload', { method: 'POST', body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || '上传失败');
    await load();
  }

  function bind() {
    const uploadBtn = document.getElementById('standardUploadBtn');
    const uploadInput = document.getElementById('standardApkFile');
    const uploadName = document.getElementById('standardUploadName');

    if (uploadBtn && uploadInput) {
      uploadBtn.addEventListener('click', () => uploadInput.click());
      uploadInput.addEventListener('change', () => {
        const file = uploadInput.files?.[0];
        if (uploadName) uploadName.textContent = file?.name || '未选择文件';
        if (file) {
          uploadStandard(file).catch((e) => alert(e.message || '上传失败'));
        }
      });
    }

    const list = document.getElementById('standardPackageList');
    if (list) {
      list.addEventListener('click', (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        const action = target.getAttribute('data-action');
        const id = target.getAttribute('data-id');
        if (!action || !id) return;
        if (action === 'set-standard') {
          setStandard(id).catch((err) => alert(err.message || '设置失败'));
        } else if (action === 'delete') {
          deleteItem(id).catch((err) => alert(err.message || '删除失败'));
        }
      });
    }
  }

  return { bind, load };
}
