import { state, setIcon } from './state.js';
import { createEmbedHost } from './embed/host.js';
import { renderStandardPackageSection, createStandardPackageSection } from './sections/standard-package.js';
import { renderHeader } from './sections/header.js';
import { renderPackageInfoSection, bindPackageInfoSection } from './sections/package-info.js';
import { renderSceneConfigSection, createSceneConfigSection } from './sections/scene-config.js';
import { renderSubmitSection, createSubmitSection } from './sections/submit.js';
import { renderIconEditorModal, createIconEditor } from './modals/icon-editor.js';
import { showAlert } from './embed/notify.js';
import { initThemeSync } from './theme.js';
import { t } from './i18n.js';

initThemeSync();
document.title = t('app.titleEmbed');

const host = createEmbedHost();

const root = document.getElementById('app') || document.body;
const wrap = document.createElement('div');
wrap.className = 'wrap';
root.appendChild(wrap);

async function getAllowedActions() {
  try {
    const res = await host.hostFetch('/v1/plugin/allowed-actions?plugin_name=apk-rebuilder');
    const json = await res.json().catch(() => ({}));
    const data = json?.data || json;
    return Array.isArray(data?.actions) ? data.actions : [];
  } catch {
    return [];
  }
}

async function main() {
  const actions = await getAllowedActions();
  const canAdmin = actions.includes('apk.rebuilder.admin');

  renderHeader(wrap, {
    title: t('app.title'),
    subtitle: t('header.subtitle.embed'),
    showSubtitle: true,
    showToolsCheck: false,
  });

  if (canAdmin) {
    renderStandardPackageSection(wrap, { canAdmin });
  }
  renderPackageInfoSection(wrap, {
    showOriginal: false,
    fields: ['appName'],
    showIcon: true,
    showChangeCount: false,
    title: t('pkg.title'),
  });
  renderSceneConfigSection(wrap);
  renderSubmitSection(wrap);
  renderIconEditorModal(document.body);

  const standardSection = canAdmin ? createStandardPackageSection({ host, canAdmin }) : null;
  const iconModal = createIconEditor({ state, onIconChanged: () => setIcon('newIcon', 'newIconEmpty', state.iconPreviewUrl) });
  const sceneSection = createSceneConfigSection({ host, perPage: 10 });

async function getStandardPackageId() {
  console.info('[APK-REBUILDER] call /plugin/standard-package');
  const res = await host.authFetch('/plugin/standard-package');
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || t('standard.fetchFailed'));
  const data = json?.data || json;
  return data?.standardLibraryItemId || '';
}

async function uploadIconIfNeeded() {
  const icon = state.iconFile;
  if (!icon) return null;
  const form = new FormData();
  form.append('icon', icon);
  console.info('[APK-REBUILDER] call /plugin/icon-upload');
  const res = await host.authFetch('/plugin/icon-upload', { method: 'POST', body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || t('standard.iconUploadFailed'));
  const data = json?.data || json;
  return data?.artifactId || null;
}

  const submitSection = createSubmitSection({
  host,
  getPayload: async () => {
    const appName = document.getElementById('appName')?.value.trim() || '';
    const sceneId = document.getElementById('sceneId')?.value.trim() || '';
    if (!appName) {
      await showAlert(t('embed.appNameRequired'));
      return null;
    }
    if (!sceneId) {
      await showAlert(t('embed.sceneIdRequired'));
      return null;
    }
    const standardLibraryItemId = await getStandardPackageId();
    if (!standardLibraryItemId) {
      await showAlert(t('embed.needStandard'));
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
    onPickIcon: (file) =>
      iconModal.prepareIconEditor(file).catch(() => showAlert(t('icon.readFail'))),
  });

  standardSection?.bind();
  submitSection.bind();
  iconModal.bind();
  sceneSection.bind();
  standardSection?.load().catch((e) => showAlert(e.message || t('standard.listLoadFailed')));
  sceneSection.load().catch((e) => showAlert(e.message || t('standard.sceneLoadFailed')));
}

main().catch((e) => console.error(e));
