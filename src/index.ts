import 'dotenv/config';
import app from './app';
import { APK_REBUILDER_MODE, HOST, PORT, STRICT_REDIS, STRICT_TOOLCHAIN, validateRuntimeConfig } from './config';
import { ensureRedisReady } from './taskQueue';
import { assertToolchainAvailable } from './toolchain';

async function boot(): Promise<void> {
  validateRuntimeConfig();
  if (STRICT_TOOLCHAIN) {
    assertToolchainAvailable();
  }
  if (STRICT_REDIS) {
    await ensureRedisReady();
  }

  app.listen(PORT, HOST, () => {
    console.info(`apk-rebuilder listening on http://${HOST}:${PORT} (mode=${APK_REBUILDER_MODE})`);
  });
}

boot().catch((error) => {
  console.error('[startup] failed to boot', error);
  process.exit(1);
});
