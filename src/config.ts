import fs from 'fs';
import path from 'path';

function firstExistingPath(paths: string[]): string | undefined {
  return paths.find(item => fs.existsSync(item));
}

function detectBuildTool(toolName: string): string {
  const root = '/opt/homebrew/share/android-commandlinetools/build-tools';
  if (!fs.existsSync(root)) {
    return toolName;
  }

  const versions = fs
    .readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry.name))
    .map(entry => entry.name)
    .sort()
    .reverse();

  for (const version of versions) {
    const candidate = path.join(root, version, toolName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return toolName;
}

export const PORT = Number.parseInt(process.env['PORT'] || '3000', 10);
export const HOST = process.env['HOST'] || '127.0.0.1';

export const REDIS_HOST = process.env['REDIS_HOST'] || '127.0.0.1';
export const REDIS_PORT = Number.parseInt(process.env['REDIS_PORT'] || '6379', 10);
export const REDIS_PASSWORD = process.env['REDIS_PASSWORD'] || '';

export const DATA_ROOT = path.join(process.cwd(), 'data');
export const UPLOAD_DIR = path.join(DATA_ROOT, 'uploads');
export const MOD_UPLOAD_DIR = path.join(DATA_ROOT, 'mod-uploads');
export const WORK_DIR_ROOT = path.join(DATA_ROOT, 'work');
export const APK_LIBRARY_DIR = path.join(DATA_ROOT, 'apk-library');
export const APK_LIBRARY_INDEX_PATH = path.join(DATA_ROOT, 'apk-library-index.json');
export const APK_LIBRARY_CACHE_ROOT = path.join(DATA_ROOT, 'apk-library-cache');
export const TASK_INDEX_PATH = path.join(DATA_ROOT, 'tasks.json');
export const DEBUG_KEYSTORE_PATH = path.join(DATA_ROOT, 'debug.keystore');
export const ARTIFACTS_DIR = path.join(DATA_ROOT, 'artifacts');
export const ARTIFACT_INDEX_PATH = path.join(DATA_ROOT, 'artifacts.json');
export const STANDARD_PACKAGE_PATH = path.join(DATA_ROOT, 'standard-package.json');
export const PLUGIN_MANIFEST_PATH = path.join(process.cwd(), 'src', 'plugin', 'manifest.json');

export const APKTOOL_PATH = process.env['APKTOOL_PATH'] || 'apktool';
export const ZIPALIGN_PATH = process.env['ZIPALIGN_PATH'] || detectBuildTool('zipalign');
export const APKSIGNER_PATH = process.env['APKSIGNER_PATH'] || detectBuildTool('apksigner');
export const KEYTOOL_PATH =
  process.env['KEYTOOL_PATH'] ||
  firstExistingPath([
    '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home/bin/keytool',
    '/usr/bin/keytool',
  ]) ||
  'keytool';
export const JAVA_PATH =
  process.env['JAVA_PATH'] ||
  firstExistingPath([
    '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home/bin/java',
    '/usr/bin/java',
  ]) ||
  'java';
export const JAVA_HOME = process.env['JAVA_HOME'] || path.dirname(path.dirname(JAVA_PATH));

export const DEBUG_ALIAS = process.env['DEBUG_KEY_ALIAS'] || 'androiddebugkey';
export const DEBUG_PASS = process.env['DEBUG_KEY_PASS'] || 'android';
export const API_KEY = process.env['API_KEY'] || process.env['AUTH_TOKEN'] || '';
export const AUTH_ENABLED = API_KEY.length > 0;
export const FRONTEND_PUBLIC_DIR = path.join(process.cwd(), 'public');
export const PLUGIN_ID = process.env['PLUGIN_ID'] || 'apk-rebuilder';
export const PLUGIN_TOKEN_SECRET = process.env['PLUGIN_TOKEN_SECRET'] || '';

export function ensureRuntimeDirs(): void {
  [DATA_ROOT, UPLOAD_DIR, MOD_UPLOAD_DIR, WORK_DIR_ROOT, APK_LIBRARY_DIR, APK_LIBRARY_CACHE_ROOT, ARTIFACTS_DIR].forEach(dir =>
    fs.mkdirSync(dir, { recursive: true }),
  );

  if (!fs.existsSync(APK_LIBRARY_INDEX_PATH)) {
    fs.writeFileSync(APK_LIBRARY_INDEX_PATH, '[]\n', 'utf8');
  }
  if (!fs.existsSync(TASK_INDEX_PATH)) {
    fs.writeFileSync(TASK_INDEX_PATH, '[]\n', 'utf8');
  }
  if (!fs.existsSync(ARTIFACT_INDEX_PATH)) {
    fs.writeFileSync(ARTIFACT_INDEX_PATH, '[]\n', 'utf8');
  }
}
