import { t } from '../i18n.js';

export function renderHeader(container, options = {}) {
  const {
    title = t('app.title'),
    subtitle = t('header.subtitle.short'),
    showSubtitle = true,
    showToolsCheck = false,
  } = options || {};

  container.insertAdjacentHTML(
    'beforeend',
    `
    <div class="apk-header">
      <div class="apk-header-left">
        <div class="apk-header-title">${title}</div>
        ${showSubtitle ? `<div class="apk-header-subtitle">${subtitle}</div>` : ''}
      </div>
      ${showToolsCheck ? '<div class="apk-header-tools" id="toolsCheckSlot"></div>' : ''}
    </div>
    `
  );
}
