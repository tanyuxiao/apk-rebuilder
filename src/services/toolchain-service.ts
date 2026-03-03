import { execa } from 'execa';
import { apktoolPath, apksignerPath, javaHome, javaPath, keytoolPath, zipalignPath } from '../config/env.js';

export async function checkCommand(
  command: string,
  args: string[] = ['--version'],
  allowedExitCodes: number[] = []
): Promise<{ ok: boolean; detail: string }> {
  try {
    const { stdout, stderr } = await execa(command, args, {
      env: { ...process.env, JAVA_HOME: javaHome }
    });
    return { ok: true, detail: (stdout || stderr || 'ok').split('\n')[0] };
  } catch (error) {
    if (
      typeof error === 'object' &&
      error &&
      'exitCode' in error &&
      allowedExitCodes.includes(Number((error as { exitCode?: number }).exitCode))
    ) {
      const e = error as { stdout?: string; stderr?: string };
      return { ok: true, detail: (e.stdout || e.stderr || 'ok').split('\n')[0] };
    }
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: msg };
  }
}

export async function runCommand(command: string, args: string[]): Promise<void> {
  await execa(command, args, {
    env: { ...process.env, JAVA_HOME: javaHome }
  });
}

export async function getToolchainStatus(): Promise<{
  tools: {
    apktool: { command: string; ok: boolean; detail: string };
    zipalign: { command: string; ok: boolean; detail: string };
    apksigner: { command: string; ok: boolean; detail: string };
    keytool: { command: string; ok: boolean; detail: string };
    java: { command: string; ok: boolean; detail: string };
  };
}> {
  const [apktool, zipalignRaw, apksigner, keytool, java] = await Promise.all([
    apktoolPath.endsWith('.jar') ? checkCommand(javaPath, ['-jar', apktoolPath, '--version']) : checkCommand(apktoolPath),
    checkCommand(zipalignPath, ['--version'], [2]),
    checkCommand(apksignerPath, ['--version'], [1, 2]),
    checkCommand(keytoolPath, ['-help']),
    checkCommand(javaPath, ['-version'])
  ]);
  const zipalign = zipalignRaw.ok
    ? zipalignRaw
    : {
        ok: true,
        detail: `optional fallback enabled (${zipalignRaw.detail.split('\n')[0]})`
      };

  return {
    tools: {
      apktool: { command: apktoolPath, ...apktool },
      zipalign: { command: zipalignPath, ...zipalign },
      apksigner: { command: apksignerPath, ...apksigner },
      keytool: { command: keytoolPath, ...keytool },
      java: { command: javaPath, ...java }
    }
  };
}
