import fse from 'fs-extra';
import path from 'node:path';

function firstExistingPath(paths: string[]): string | undefined {
  return paths.find((p) => fse.existsSync(p));
}

function detectBuildTool(toolName: 'zipalign' | 'apksigner'): string {
  const root = '/opt/homebrew/share/android-commandlinetools/build-tools';
  if (!fse.existsSync(root)) {
    return toolName;
  }
  const versions = fse
    .readdirSync(root)
    .filter((entry) => /^\d+\.\d+\.\d+$/.test(entry))
    .sort((a, b) => (a < b ? 1 : -1));

  for (const version of versions) {
    const candidate = path.join(root, version, toolName);
    if (fse.existsSync(candidate)) {
      return candidate;
    }
  }
  return toolName;
}

export const port = Number(process.env.PORT || 3000);
export const host = process.env.HOST || '127.0.0.1';

export const dataRoot = path.resolve(process.cwd(), 'data');
export const uploadDir = path.join(dataRoot, 'uploads');
export const modUploadDir = path.join(dataRoot, 'mod-uploads');
export const workDirRoot = path.join(dataRoot, 'work');

export const apktoolPath = process.env.APKTOOL_PATH || 'apktool';
export const zipalignPath = process.env.ZIPALIGN_PATH || detectBuildTool('zipalign');
export const apksignerPath = process.env.APKSIGNER_PATH || detectBuildTool('apksigner');

export const keytoolPath =
  process.env.KEYTOOL_PATH ||
  firstExistingPath(['/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home/bin/keytool', '/usr/bin/keytool']) ||
  'keytool';

export const javaPath =
  process.env.JAVA_PATH ||
  firstExistingPath(['/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home/bin/java', '/usr/bin/java']) ||
  'java';

export const javaHome = process.env.JAVA_HOME || path.dirname(path.dirname(javaPath));

export const debugKeystorePath = path.join(dataRoot, 'debug.keystore');
export const debugAlias = process.env.DEBUG_KEY_ALIAS || 'androiddebugkey';
export const debugPass = process.env.DEBUG_KEY_PASS || 'android';
export const apiKey = process.env.API_KEY || process.env.AUTH_TOKEN || '';
export const authEnabled = apiKey.length > 0;
export const authToken = apiKey;

export const frontendPublicDir =
  firstExistingPath([path.resolve(process.cwd(), 'public'), path.resolve(process.cwd(), 'packages/backend/public')]) ||
  path.resolve(process.cwd(), 'public');

export function ensureRuntimeDirs(): void {
  fse.ensureDirSync(uploadDir);
  fse.ensureDirSync(modUploadDir);
  fse.ensureDirSync(workDirRoot);
}
