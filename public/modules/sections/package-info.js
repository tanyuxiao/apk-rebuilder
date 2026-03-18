export function renderPackageInfoSection(container, options = {}) {
  const {
    showOriginal = true,
    fields = ['appName', 'packageName', 'versionName', 'versionCode'],
    showIcon = true,
    showChangeCount = true,
    title = '包信息修改',
  } = options;

  const fieldLabelMap = {
    appName: '应用名',
    packageName: '包名',
    versionName: '版本名',
    versionCode: '版本号',
  };

  const renderField = (field) => {
    const label = fieldLabelMap[field] || field;
    return `<div class="field"><label>${label}</label><input id="${field}" type="text" /></div>`;
  };

  const fieldsHtml = fields.map(renderField).join('');

  const originalHtml = showOriginal
    ? `
        <div class="compare-box readonly-pane">
          <div class="compare-title">原包信息 <span class="readonly-hint">只读</span></div>
          <div class="icon-box">
            <img id="srcIcon" alt="source icon" style="display:none" />
            <span id="srcIconEmpty" class="icon-empty">无图标</span>
          </div>
          <div class="kv"><span class="k">应用名</span><span class="v" id="srcName">-</span><span></span></div>
          <div class="kv"><span class="k">包名</span><span class="v" id="srcPkg">-</span><span></span></div>
          <div class="kv"><span class="k">版本名</span><span class="v" id="srcVer">-</span><span></span></div>
          <div class="kv"><span class="k">版本号</span><span class="v" id="srcCode">-</span><span></span></div>
        </div>
      `
    : '';

  const iconHtml = showIcon
    ? `
        <div class="icon-box">
          <img id="newIcon" alt="new icon" style="display:none" />
          <span id="newIconEmpty" class="icon-empty">无图标</span>
        </div>
        <div class="field">
          <label>新图标（png/webp/jpg）</label>
          <div class="file-pick">
            <input id="iconFile" type="file" accept=".png,.webp,.jpg,.jpeg,image/png,image/webp,image/jpeg" />
            <button id="pickIconBtn" type="button" class="secondary">选择图标文件</button>
            <span id="iconFileName" class="file-name">未选择任何文件</span>
          </div>
        </div>
      `
    : '';

  const gridStyle = showOriginal ? 'margin-top:10px' : 'margin-top:10px; grid-template-columns: 1fr;';

  container.insertAdjacentHTML(
    'beforeend',
    `
    <div class="card" id="sectionPackageInfo">
      <div class="toolbar">
        <strong>${title}</strong>
        ${showChangeCount ? '<div><span class="tag warn" id="changedCount">字段变更 0 项</span></div>' : ''}
      </div>
      <div class="grid" style="${gridStyle}">
        ${originalHtml}
        <div class="compare-box editable-pane">
          <div class="compare-title">修改信息</div>
          ${iconHtml}
          ${fieldsHtml}
        </div>
      </div>
    </div>
    `
  );
}

export function bindPackageInfoSection({ onInputChange, onPickIcon }) {
  ['appName', 'packageName', 'versionName', 'versionCode'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', onInputChange);
    el.addEventListener('change', onInputChange);
  });

  const pickBtn = document.getElementById('pickIconBtn');
  const iconFile = document.getElementById('iconFile');
  if (pickBtn && iconFile) {
    pickBtn.addEventListener('click', () => iconFile.click());
    iconFile.addEventListener('change', () => {
      const file = iconFile.files?.[0];
      if (file) onPickIcon(file);
    });
  }
}
