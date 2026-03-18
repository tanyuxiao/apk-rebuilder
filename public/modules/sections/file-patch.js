import { createPatchId, escapeHtml, formatBytes } from '../state.js';

function createFilePatchTask() {
  return {
    id: createPatchId(),
    enabled: true,
    collapsed: false,
    path: '',
    method: 'edit',
    loadStatusText: '未读取文件',
    loadStatusKind: '',
    originalContent: '',
    modifiedContent: '',
    matchText: '',
    replaceText: '',
    matchRegex: false,
    replaceFile: null,
    replaceFileName: '未选择任何文件',
  };
}

function getSupportedModeLabel(editable, replaceable) {
  if (editable && replaceable) return '可编辑 / 可替换';
  if (editable) return '可编辑';
  if (replaceable) return '仅可替换';
  return '不可修改';
}

export function renderFilePatchSection(container) {
  container.insertAdjacentHTML(
    'beforeend',
    `
    <div class="card" id="sectionFilePatch">
      <div class="toolbar">
        <strong>文件信息修改</strong>
      </div>
      <div style="margin-top:12px;">
        <div class="patch-queue">
          <div class="patch-queue-head">
            <div class="patch-queue-title">任务队列（<span id="patchQueueCount">0</span>）</div>
            <div class="row" style="margin-top:0;">
              <button id="createFilePatchTaskBtn" class="secondary" type="button">创建任务</button>
              <button id="clearPatchQueueBtn" class="secondary" type="button">清空任务</button>
            </div>
          </div>
          <div id="patchQueueList" class="patch-queue-list muted">暂无修改任务</div>
          <datalist id="filePathSuggestions"></datalist>
        </div>
      </div>
    </div>
    `
  );
}

export function createFilePatchSection({ state, api }) {
  function getFilePatchTask(taskId) {
    return state.filePatchTasks.find((x) => x.id === taskId);
  }

  function renderPatchQueue() {
    const list = document.getElementById('patchQueueList');
    const tasks = state.filePatchTasks || [];
    const enabledCount = tasks.filter((x) => x.enabled).length;
    const countEl = document.getElementById('patchQueueCount');
    if (countEl) countEl.textContent = `${enabledCount}/${tasks.length}`;

    if (!list) return;
    if (!tasks.length) {
      list.classList.add('muted');
      list.innerHTML = '暂无修改任务';
      return;
    }

    list.classList.remove('muted');
    list.innerHTML = tasks
      .map((task, idx) => {
        const pathText = task.path?.trim() || '未设置路径';
        const modeText = task.method === 'replace' ? '替换' : '编辑';
        const summary = `${pathText} | ${modeText}`;
        const statusClass = task.loadStatusKind === 'ok' ? 'ok' : (task.loadStatusKind === 'fail' ? 'fail' : '');
        const methodEditBg = task.method === 'edit' ? 'var(--primary-color)' : 'var(--bg-hover)';
        const methodReplaceBg = task.method === 'replace' ? 'var(--primary-color)' : 'var(--bg-hover)';
        return `
          <div class="patch-row ${task.collapsed ? 'collapsed' : ''}" data-task-id="${task.id}">
            <div class="patch-row-top">
              <div class="patch-row-left">
                <input type="checkbox" data-action="toggle-enable" ${task.enabled ? 'checked' : ''} />
                <button class="patch-open-btn" type="button" data-action="toggle-collapse" title="展开或收纳任务">#${idx + 1} ${escapeHtml(summary)}</button>
              </div>
              <div class="patch-row-right">
                <button class="icon-btn" type="button" data-action="toggle-collapse" title="${task.collapsed ? '展开' : '收纳'}">${task.collapsed ? '▸' : '▾'}</button>
                <button class="icon-btn" type="button" data-action="move-up" title="上移" ${idx === 0 ? 'disabled' : ''}>↑</button>
                <button class="icon-btn" type="button" data-action="move-down" title="下移" ${idx === tasks.length - 1 ? 'disabled' : ''}>↓</button>
                <button class="icon-btn" type="button" data-action="remove" title="删除">✕</button>
              </div>
            </div>
            <div class="task-body" style="display:${task.collapsed ? 'none' : 'block'};">
              <div class="target-file-row">
                <span class="target-file-label">目标文件路径</span>
                <input type="text" data-field="path" list="filePathSuggestions" value="${escapeHtml(task.path || '')}" placeholder="例如 assets/StreamingAssets/scene-config.json" />
                <button class="secondary" type="button" data-action="load-file">读取文件</button>
              </div>
              <div class="load-status ${statusClass}">${escapeHtml(task.loadStatusText || '未读取文件')}</div>

              <div class="row" style="margin-top:8px;">
                <button class="secondary" type="button" data-action="set-method" data-method="edit" style="background:${methodEditBg}">编辑</button>
                <button class="secondary" type="button" data-action="set-method" data-method="replace" style="background:${methodReplaceBg}">替换</button>
              </div>

              <div style="display:${task.method === 'edit' ? 'block' : 'none'};">
                <div class="unity-grid">
                  <div>
                    <div class="muted" style="margin-bottom:6px;">原文件内容（只读）</div>
                    <textarea readonly data-field="originalContent">${escapeHtml(task.originalContent || '')}</textarea>
                  </div>
                  <div>
                    <div class="muted" style="margin-bottom:6px;">修改后内容（可编辑）</div>
                    <textarea data-field="modifiedContent" placeholder="读取文件后可直接编辑替换">${escapeHtml(task.modifiedContent || '')}</textarea>
                  </div>
                </div>
                <div class="grid" style="margin-top:8px;">
                  <div class="field"><label>匹配文本</label><input type="text" data-field="matchText" value="${escapeHtml(task.matchText || '')}" /></div>
                  <div class="field"><label>替换文本</label><input type="text" data-field="replaceText" value="${escapeHtml(task.replaceText || '')}" /></div>
                </div>
                <div class="row" style="margin-top:4px;">
                  <label class="muted" style="display:flex; align-items:center; gap:6px;">
                    <input type="checkbox" data-field="matchRegex" ${task.matchRegex ? 'checked' : ''} /> 正则表达式
                  </label>
                </div>
              </div>

              <div style="display:${task.method === 'replace' ? 'block' : 'none'}; margin-top:8px;">
                <div class="field">
                  <label>选择替换文件</label>
                  <div class="file-pick">
                    <input type="file" data-action="replace-file-input" />
                    <button class="secondary" type="button" data-action="pick-replace-file">选择文件</button>
                    <span class="file-name">${escapeHtml(task.replaceFileName || '未选择任何文件')}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  async function loadTaskFile(taskId, silent = false) {
    const task = getFilePatchTask(taskId);
    if (!task) return;
    if (!state.id) {
      if (!silent) alert('请先上传并解析 APK');
      return;
    }
    const editPath = String(task.path || '').trim();
    if (!editPath) {
      task.loadStatusText = '读取失败：请先填写目标文件路径';
      task.loadStatusKind = 'fail';
      renderPatchQueue();
      if (!silent) alert('请先填写目标文件路径');
      return;
    }
    try {
      const data = await api(`/api/edit-file/${state.id}?path=${encodeURIComponent(editPath)}`);
      const normalizedPath = data.path || editPath;
      task.path = normalizedPath;
      task.originalContent = data.content || '';
      task.modifiedContent = data.content || '';
      if (!data.editable) {
        task.method = 'replace';
      }
      task.loadStatusText = `读取成功：${normalizedPath} | ${formatBytes(Number(data.size || 0))} | ${getSupportedModeLabel(Boolean(data.editable), Boolean(data.replaceable ?? true))}`;
      task.loadStatusKind = 'ok';
      renderPatchQueue();
    } catch (e) {
      task.loadStatusText = `读取失败：${e?.message || '未知错误'}`;
      task.loadStatusKind = 'fail';
      renderPatchQueue();
      if (!silent) throw e;
    }
  }

  function collectTaskDraftPatches(task) {
    const path = String(task.path || '').trim();
    if (!path) return [];

    if (task.method === 'replace') {
      if (!task.replaceFile) return [];
      return [
        {
          path,
          mode: 'file_replace',
          replacementFile: task.replaceFile,
          replacementFileName: task.replaceFileName || task.replaceFile.name || 'replacement.bin',
        }
      ];
    }

    const drafts = [];
    const matchText = String(task.matchText || '');
    const replaceText = String(task.replaceText || '');
    if (matchText) {
      drafts.push({ path, mode: 'text_replace', matchText, replaceText, regex: Boolean(task.matchRegex) });
    }

    const original = String(task.originalContent || '');
    const modified = String(task.modifiedContent || '');
    if ((original || modified) && original !== modified) {
      drafts.push({ path, mode: 'direct_edit', content: modified });
    }
    return drafts;
  }

  async function buildQueuedFilePatchesInput(fileToBase64) {
    const result = [];
    for (const task of state.filePatchTasks) {
      if (!task.enabled) continue;
      const drafts = collectTaskDraftPatches(task);
      if (!drafts.length) {
        continue;
      }
      for (const patch of drafts) {
        if (patch.mode === 'file_replace') {
          const file = patch.replacementFile;
          if (!file) {
            throw new Error(`替换任务缺少文件: ${patch.path}`);
          }
          result.push({
            path: patch.path,
            mode: 'file_replace',
            replacementBase64: await fileToBase64(file),
          });
          continue;
        }
        if (patch.mode === 'text_replace') {
          result.push({
            path: patch.path,
            mode: 'text_replace',
            matchText: patch.matchText || '',
            replaceText: patch.replaceText || '',
            regex: Boolean(patch.regex),
          });
          continue;
        }
        if (patch.mode === 'direct_edit') {
          result.push({
            path: patch.path,
            mode: 'direct_edit',
            content: patch.content || '',
          });
        }
      }
    }
    return result;
  }

  function renderFilePathSuggestions() {
    const datalist = document.getElementById('filePathSuggestions');
    if (!datalist) return;
    datalist.innerHTML = '';
    const paths = (state.filePathCandidates || []).slice(0, 4000);
    paths.forEach((path) => {
      const option = document.createElement('option');
      option.value = path;
      datalist.appendChild(option);
    });
  }

  function bind() {
    const createBtn = document.getElementById('createFilePatchTaskBtn');
    const clearBtn = document.getElementById('clearPatchQueueBtn');
    const list = document.getElementById('patchQueueList');

    if (createBtn) {
      createBtn.addEventListener('click', () => {
        if (!state.id) {
          alert('请先上传 APK 或从左侧选择一个已上传安装包');
          return;
        }
        if (state.status !== 'success') {
          alert('当前 APK 尚未解析完成，请稍后再创建任务');
          return;
        }
        state.filePatchTasks.push(createFilePatchTask());
        renderPatchQueue();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (!state.filePatchTasks.length) return;
        if (!confirm('确认清空所有修改任务吗？')) return;
        state.filePatchTasks = [];
        renderPatchQueue();
      });
    }

    if (!list) return;
    list.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const row = target.closest('[data-task-id]');
      if (!row) return;
      const taskId = row.getAttribute('data-task-id') || '';
      const task = getFilePatchTask(taskId);
      if (!task) return;
      const action = target.getAttribute('data-action') || '';

      if (action === 'toggle-collapse') {
        task.collapsed = !task.collapsed;
        renderPatchQueue();
        return;
      }
      if (action === 'move-up') {
        const idx = state.filePatchTasks.findIndex((x) => x.id === taskId);
        if (idx > 0) {
          const tmp = state.filePatchTasks[idx - 1];
          state.filePatchTasks[idx - 1] = state.filePatchTasks[idx];
          state.filePatchTasks[idx] = tmp;
          renderPatchQueue();
        }
        return;
      }
      if (action === 'move-down') {
        const idx = state.filePatchTasks.findIndex((x) => x.id === taskId);
        if (idx >= 0 && idx < state.filePatchTasks.length - 1) {
          const tmp = state.filePatchTasks[idx + 1];
          state.filePatchTasks[idx + 1] = state.filePatchTasks[idx];
          state.filePatchTasks[idx] = tmp;
          renderPatchQueue();
        }
        return;
      }
      if (action === 'remove') {
        state.filePatchTasks = state.filePatchTasks.filter((x) => x.id !== taskId);
        renderPatchQueue();
        return;
      }
      if (action === 'set-method') {
        const method = target.getAttribute('data-method');
        if (method === 'edit' || method === 'replace') {
          task.method = method;
          renderPatchQueue();
        }
        return;
      }
      if (action === 'pick-replace-file') {
        const input = row.querySelector('input[data-action="replace-file-input"]');
        if (input instanceof HTMLInputElement) {
          input.click();
        }
        return;
      }
      if (action === 'load-file') {
        loadTaskFile(taskId).catch((err) => alert(err.message || '读取文件失败'));
      }
    });

    list.addEventListener('change', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      const row = target.closest('[data-task-id]');
      if (!row) return;
      const taskId = row.getAttribute('data-task-id') || '';
      const task = getFilePatchTask(taskId);
      if (!task) return;

      const action = target.getAttribute('data-action') || '';
      const field = target.getAttribute('data-field') || '';

      if (action === 'toggle-enable') {
        task.enabled = Boolean(target.checked);
        renderPatchQueue();
        return;
      }
      if (action === 'replace-file-input') {
        const file = target.files?.[0] || null;
        task.replaceFile = file;
        task.replaceFileName = file ? (file.name || '已选文件') : '未选择任何文件';
        renderPatchQueue();
        return;
      }
      if (field === 'matchRegex') {
        task.matchRegex = Boolean(target.checked);
        return;
      }
      if (field) {
        task[field] = target.value;
      }
    });

    list.addEventListener('input', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
      const row = target.closest('[data-task-id]');
      if (!row) return;
      const taskId = row.getAttribute('data-task-id') || '';
      const task = getFilePatchTask(taskId);
      if (!task) return;
      const field = target.getAttribute('data-field') || '';
      if (!field || field === 'originalContent') return;
      task[field] = target.value;
    });
  }

  return {
    bind,
    renderPatchQueue,
    renderFilePathSuggestions,
    loadTaskFile,
    buildQueuedFilePatchesInput,
  };
}
