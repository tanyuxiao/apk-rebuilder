import app from './app';
import { HOST, PORT } from './config';

app.listen(PORT, HOST, () => {
  console.info(`apk-modder listening on http://${HOST}:${PORT}`);
});
