import { host, port } from './config/env.js';
import { app } from './app.js';
import { logger } from './utils/logger.js';

app.listen(port, host, () => {
  logger.info({ host, port }, `backend listening on http://${host}:${port}`);
});
