import { formatBytes, fmtTime } from '../state.js';

export function renderApkLibraryDrawer(container) {
  container.insertAdjacentHTML(
    'beforeend',
    `
    <aside id="apkDrawer" class="apk-drawer">
      <div class="apk-drawer-head">
        <div class="apk-drawer-title">已上传 APK</div>
      </div>
      <div class="apk-drawer-actions">
        <button id="refreshApkLibrary" class="secondary" type="button">刷新</button>
      </div>
      <div id="apkLibraryList" class="apk-list">
        <div class="muted">暂无记录</div>
      </div>
      <button id="apkDrawerToggle" class="apk-drawer-toggle" type="button" aria-label="收起已上传安装包抽屉">
        <span id="apkDrawerToggleArrow" class="apk-drawer-toggle-arrow">«</span>
        <span class="apk-drawer-toggle-label">已上传安装包</span>
      </button>
    </aside>
    `
  );
}

export function createApkLibraryDrawer({ state, api, onUseApk }) {
  function applyDrawerState() {
    const el = document.getElementById('apkDrawer');
    if (!el) return;
    el.classList.toggle('collapsed', state.apkDrawerCollapsed);
    const arrow = document.getElementById('apkDrawerToggleArrow');
    const toggle = document.getElementById('apkDrawerToggle');
    if (arrow) arrow.textContent = state.apkDrawerCollapsed ? '»' : '«';
    if (toggle) {
      toggle.setAttribute(
        'aria-label',
        state.apkDrawerCollapsed ? '展开已上传安装包抽屉' : '收起已上传安装包抽屉'
      );
    }
  }

  function renderApkLibrary() {
    const root = document.getElementById('apkLibraryList');
    const items = state.apkLibraryItems || [];
    if (!root) return;
    if (!items.length) {
      root.innerHTML = '<div class="muted">暂无记录</div>';
      return;
    }
    root.innerHTML = items
      .map((item) => {
        const name = item.name || item.storedName || item.id;
        return `
          <div class="apk-item">
            <div class="apk-item-name">${name}</div>
            <div class="apk-item-meta">大小: ${formatBytes(Number(item.size || 0))}</div>
            <div class="apk-item-meta">上传时间: ${fmtTime(item.createdAt)}</div>
            <div class="apk-item-meta">最近使用: ${fmtTime(item.lastUsedAt || item.createdAt)}</div>
            <div class="apk-item-row">
              <button type="button" class="secondary" data-use-apk-id="${item.id}">使用</button>
              <button type="button" class="secondary" data-del-apk-id="${item.id}">删除</button>
            </div>
          </div>
        `;
      })
      .join('');

    root.querySelectorAll('[data-use-apk-id]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-use-apk-id');
        if (id) onUseApk(id).catch((e) => alert(e.message));
      });
    });
    root.querySelectorAll('[data-del-apk-id]').forEach((el) => {
      el.addEventListener('click', async () => {
        const id = el.getAttribute('data-del-apk-id');
        if (!id) return;
        if (!confirm('确认删除该 APK 记录与存储文件吗？')) return;
        await api(`/api/library/apks/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await refreshApkLibrary();
      });
    });
  }

  async function refreshApkLibrary() {
    const data = await api('/api/library/apks');
    state.apkLibraryItems = data.items || [];
    renderApkLibrary();
  }

  function bind() {
    const toggle = document.getElementById('apkDrawerToggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        state.apkDrawerCollapsed = !state.apkDrawerCollapsed;
        applyDrawerState();
      });
    }
    const refresh = document.getElementById('refreshApkLibrary');
    if (refresh) refresh.addEventListener('click', () => refreshApkLibrary().catch((e) => alert(e.message)));
  }

  return { applyDrawerState, refreshApkLibrary, renderApkLibrary, bind };
}
