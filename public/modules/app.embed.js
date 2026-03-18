import { state, setIcon } from './state.js';
import { createEmbedHost } from './embed/host.js';
import { renderStandardPackageSection, createStandardPackageSection } from './sections/standard-package.js';
import { renderPackageInfoSection, bindPackageInfoSection } from './sections/package-info.js';
import { renderSceneConfigSection } from './sections/scene-config.js';
import { renderSubmitSection, createSubmitSection } from './sections/submit.js';
import { renderIconEditorModal, createIconEditor } from './modals/icon-editor.js';

const host = createEmbedHost();

const root = document.getElementById('app') || document.body;
const wrap = document.createElement('div');
wrap.className = 'wrap';
root.appendChild(wrap);

renderStandardPackageSection(wrap);
renderPackageInfoSection(wrap, {
  showOriginal: false,
  fields: ['appName'],
  showIcon: true,
  showChangeCount: false,
  title: '包信息修改',
});
renderSceneConfigSection(wrap);
renderSubmitSection(wrap);
renderIconEditorModal(document.body);

const standardSection = createStandardPackageSection({ host });
const iconModal = createIconEditor({ state, onIconChanged: () => setIcon('newIcon', 'newIconEmpty', state.iconPreviewUrl) });

async function getStandardPackageId() {
  const res = await host.authFetch('/plugin/standard-package');
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || '标准包读取失败');
  const data = json?.data || json;
  return data?.standardLibraryItemId || '';
}

async function uploadIconIfNeeded() {
  const icon = state.iconFile;
  if (!icon) return null;
  const form = new FormData();
  form.append('icon', icon);
  const res = await host.authFetch('/plugin/icon-upload', { method: 'POST', body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || '图标上传失败');
  const data = json?.data || json;
  return data?.artifactId || null;
}

const submitSection = createSubmitSection({
  host,
  getPayload: async () => {
    const appName = document.getElementById('appName')?.value.trim() || '';
    const sceneId = document.getElementById('sceneId')?.value.trim() || '';
    if (!appName) {
      alert('请填写应用名');
      return null;
    }
    if (!sceneId) {
      alert('请填写场景号');
      return null;
    }
    const standardLibraryItemId = await getStandardPackageId();
    if (!standardLibraryItemId) {
      alert('请先在标准包管理中设置当前标准包');
      return null;
    }
    const iconArtifactId = await uploadIconIfNeeded();
    return {
      input: {
        source: { libraryItemId: standardLibraryItemId },
        modifications: {
          appName,
          unityPatches: [{ path: 'sceneId', value: /^\d+$/.test(sceneId) ? Number(sceneId) : sceneId }],
          unityConfigPath: null,
          iconArtifactId,
        },
        options: {
          async: true,
          reuseDecodedCache: true,
          useStandardPackage: true,
        },
      },
    };
  },
});

bindPackageInfoSection({
  onInputChange: () => {},
  onPickIcon: (file) => iconModal.prepareIconEditor(file).catch(() => alert('无法读取该图标文件，请更换后重试')),
});

standardSection.bind();
submitSection.bind();
iconModal.bind();
standardSection.load().catch((e) => alert(e.message || '标准包列表加载失败'));
