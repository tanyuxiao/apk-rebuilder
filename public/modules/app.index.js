import { initApp } from './app.shared.js';
import { initThemeSync } from './theme.js';
import { t } from './i18n.js';

initThemeSync();
document.title = t('app.title');

initApp({
  showDrawers: true,
  showToolsCheck: true,
  showFilePatch: true,
  showIconEditor: true,
});
