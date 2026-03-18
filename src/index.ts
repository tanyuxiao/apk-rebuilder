import app from './app';
import { APK_REBUILDER_MODE, HOST, PORT } from './config';

app.listen(PORT, HOST, () => {
  console.info(`apk-rebuilder listening on http://${HOST}:${PORT} (mode=${APK_REBUILDER_MODE})`);
});
