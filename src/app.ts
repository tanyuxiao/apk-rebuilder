import cors from 'cors';
import express from 'express';
import fse from 'fs-extra';
import path from 'node:path';
import swaggerUi from 'swagger-ui-express';
import { ensureRuntimeDirs, frontendPublicDir } from './config/env.js';
import { swaggerSpec } from './config/swagger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { healthRouter } from './routes/health.js';
import { createTaskRouter } from './routes/tasks.js';
import { apkRouter } from './routes/apk.js';
import { logger } from './utils/logger.js';

export const app = express();

ensureRuntimeDirs();

app.use(cors());
app.use(express.json());
app.use((req, _res, next) => {
  logger.info({ method: req.method, path: req.path }, 'request');
  next();
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use(healthRouter);
app.use(createTaskRouter());
app.use(apkRouter);

if (fse.existsSync(frontendPublicDir)) {
  app.use(express.static(frontendPublicDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(path.join(frontendPublicDir, 'index.html'));
  });
}

app.use(notFoundHandler);
app.use(errorHandler);
