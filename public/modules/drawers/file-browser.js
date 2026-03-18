import { formatBytes } from '../state.js';

export function renderFileBrowserDrawer(container) {
  container.insertAdjacentHTML(
    'beforeend',
    `
    <aside id="fileDrawer" class="file-drawer collapsed">
      <div class="apk-drawer-head">
        <div class="apk-drawer-title" style="display:flex; align-items:baseline; gap:8px; min-width:0;">
          <span>文件浏览</span>
          <span id="currentBrowseApk" class="muted" style="font-weight:400;">当前 APK: -</span>
        </div>
      </div>
      <div style="padding: 10px 10px 8px;">
        <input id="fileTreeSearch" type="text" placeholder="搜索文件（支持路径关键字）" />
      </div>
      <div class="file-browser-wrap" style="padding: 0 10px 10px; margin-top: 0;">
        <div class="file-pane tree-pane">
          <div id="fileTreeRoot" class="file-tree muted">请先上传并解析 APK</div>
        </div>
        <div class="file-pane content-pane">
          <div class="file-meta-row">
            <div id="fileMeta" class="file-meta" style="margin-bottom:0;">请选择文件查看内容</div>
            <button id="copyFilePathBtn" class="secondary" type="button">复制路径</button>
          </div>
          <pre id="fileContent" class="file-content">请选择左侧文件</pre>
        </div>
      </div>
      <button id="fileDrawerToggle" class="file-drawer-toggle" type="button" aria-label="展开文件浏览抽屉">
        <span id="fileDrawerToggleArrow" class="apk-drawer-toggle-arrow">«</span>
        <span class="file-drawer-toggle-label">文件浏览</span>
      </button>
    </aside>
    `
  );
}

export function createFileBrowserDrawer({ state, api, onFilePaths }) {
  function applyFileDrawerState() {
    const el = document.getElementById('fileDrawer');
    if (!el) return;
    el.classList.toggle('collapsed', state.fileDrawerCollapsed);
    const arrow = document.getElementById('fileDrawerToggleArrow');
    const toggle = document.getElementById('fileDrawerToggle');
    if (arrow) arrow.textContent = state.fileDrawerCollapsed ? '«' : '»';
    if (toggle) {
      toggle.setAttribute(
        'aria-label',
        state.fileDrawerCollapsed ? '展开文件浏览抽屉' : '收起文件浏览抽屉'
      );
    }
  }

  function renderCurrentBrowseApk() {
    const el = document.getElementById('currentBrowseApk');
    if (el) el.textContent = `当前 APK: ${state.currentBrowseApkName || '-'}`;
  }

  function renderFileTree() {
    const root = document.getElementById('fileTreeRoot');
    const data = state.fileTreeData;
    if (!root) return;
    if (!data?.tree) {
      root.innerHTML = '<span class="muted">请先上传并解析 APK</span>';
      return;
    }

    const keyword = String(state.fileTreeSearch || '').trim().toLowerCase();
    const filterNode = (node) => {
      if (!keyword) return node;
      if (node.type === 'file') {
        const name = String(node.name || '').toLowerCase();
        const path = String(node.path || '').toLowerCase();
        return name.includes(keyword) || path.includes(keyword) ? node : null;
      }
      const children = Array.isArray(node.children) ? node.children : [];
      const filteredChildren = children.map(filterNode).filter(Boolean);
      const name = String(node.name || '').toLowerCase();
      const path = String(node.path || '').toLowerCase();
      if (filteredChildren.length || name.includes(keyword) || path.includes(keyword)) {
        return { ...node, children: filteredChildren };
      }
      return null;
    };

    const filteredRoot = filterNode(data.tree);
    if (!filteredRoot) {
      root.innerHTML = `<span class="muted">未找到匹配文件：${state.fileTreeSearch}</span>`;
      return;
    }

    const renderNode = (node) => {
      if (node.type === 'dir') {
        const children = (node.children || []).map(renderNode).join('');
        return `
          <details open>
            <summary>📁 ${node.name}</summary>
            <div class="children">${children || '<span class="muted">空目录</span>'}</div>
          </details>
        `;
      }
      const isActive = state.fileActivePath === node.path ? 'active' : '';
      return `
        <div>
          <button class="file-link ${isActive}" data-file-path="${node.path}" type="button">📄 ${node.name}</button>
        </div>
      `;
    };

    root.innerHTML = renderNode(filteredRoot);
    root.querySelectorAll('[data-file-path]').forEach((el) => {
      el.addEventListener('click', () => {
        const p = el.getAttribute('data-file-path');
        if (p) loadFileContent(p).catch((e) => alert(e.message));
      });
    });
  }

  function collectFilePaths(node, out) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'file' && node.path) {
      out.push(String(node.path));
      return;
    }
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach((child) => collectFilePaths(child, out));
  }

  async function refreshFileTree() {
    const root = document.getElementById('fileTreeRoot');
    if (!state.id) {
      if (root) root.innerHTML = '<span class="muted">请先上传并解析 APK</span>';
      state.filePathCandidates = [];
      onFilePaths();
      return;
    }
    const data = await api(`/api/files/${state.id}/tree`);
    state.fileTreeData = data;
    state.fileTreeLoadedTaskId = state.id;
    const paths = [];
    collectFilePaths(data?.tree, paths);
    state.filePathCandidates = [...new Set(paths)].sort((a, b) => a.localeCompare(b));
    onFilePaths();
    renderFileTree();
  }

  async function loadFileContent(filePath) {
    if (!state.id) return;
    const data = await api(`/api/files/${state.id}/content?path=${encodeURIComponent(filePath)}`);
    state.fileActivePath = filePath;
    renderFileTree();

    const meta = document.getElementById('fileMeta');
    const content = document.getElementById('fileContent');
    if (!meta || !content) return;

    const truncatedHint = data.truncated ? '（已截断）' : '';
    meta.textContent = `${data.path} | ${data.mime} | ${formatBytes(data.size)} ${truncatedHint}`.trim();

    if (data.kind === 'binary') {
      content.textContent = `[二进制文件]\nBase64 预览（最多 ${formatBytes(512 * 1024)}）:\n\n${data.content}`;
      return;
    }
    content.textContent = data.content || '';
  }

  async function copyCurrentFilePath() {
    const path = state.fileActivePath || '';
    if (!path) {
      alert('请先在左侧选择一个文件');
      return;
    }

    try {
      await navigator.clipboard.writeText(path);
      const btn = document.getElementById('copyFilePathBtn');
      if (btn) btn.textContent = '已复制';
      setTimeout(() => {
        if (btn) btn.textContent = '复制路径';
      }, 1200);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = path;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      const btn = document.getElementById('copyFilePathBtn');
      if (btn) btn.textContent = '已复制';
      setTimeout(() => {
        if (btn) btn.textContent = '复制路径';
      }, 1200);
    }
  }

  function bind() {
    const toggle = document.getElementById('fileDrawerToggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        state.fileDrawerCollapsed = !state.fileDrawerCollapsed;
        applyFileDrawerState();
      });
    }
    const search = document.getElementById('fileTreeSearch');
    if (search) {
      search.addEventListener('input', (e) => {
        const target = e.target;
        if (!(target instanceof HTMLInputElement)) return;
        state.fileTreeSearch = target.value || '';
        renderFileTree();
      });
    }
    const copyBtn = document.getElementById('copyFilePathBtn');
    if (copyBtn) copyBtn.addEventListener('click', () => copyCurrentFilePath().catch((e) => alert(e.message)));
  }

  return {
    bind,
    applyFileDrawerState,
    renderCurrentBrowseApk,
    renderFileTree,
    refreshFileTree,
    loadFileContent,
  };
}
