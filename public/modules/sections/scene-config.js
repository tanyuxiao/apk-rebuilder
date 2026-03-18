export function renderSceneConfigSection(container) {
  container.insertAdjacentHTML(
    'beforeend',
    `
    <div class="card" id="sectionSceneConfig">
      <div class="toolbar">
        <strong>文件信息修改</strong>
      </div>
      <div class="field" style="margin-top:10px;">
        <label>Unity scene-config 场景号</label>
        <input id="sceneId" type="text" placeholder="请输入场景号" />
        <div class="muted">固定修改路径：assets/StreamingAssets/scene-config.json</div>
      </div>
    </div>
    `
  );
}
