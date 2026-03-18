import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { APK_REBUILDER_MODE, HOST, PORT, FRONTEND_PUBLIC_DIR, ensureRuntimeDirs } from './config';
import { createPluginRouter } from './plugin/routes';
import { createApiRouter } from './api/routes';
import { ok, fail } from './common/response';

import './taskQueue'; // Initialize BullMQ worker

const app = express();

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { success: false, error: { message: 'Too many requests, please try again later.', code: 'RATE_LIMIT_EXCEEDED' } },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', apiLimiter);
app.use('/plugin', apiLimiter);

ensureRuntimeDirs();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use((req, _res, next) => {
  console.info(`request method=${req.method} path=${req.path}`);
  next();
});

// plugin interface
app.use('/plugin', createPluginRouter());

// optional local UI / debugging API (for development/demo only)
app.use('/api', createApiRouter());

// static fallback used by local frontend
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    fail(res, 404, `Route not found: GET ${req.path}`, 'NOT_FOUND');
    return;
  }
  if (APK_REBUILDER_MODE === 'dev') {
    fail(res, 404, 'Dev mode enabled. Please use the Vite dev server for UI.', 'DEV_MODE_UI');
    return;
  }
  if (!fs.existsSync(FRONTEND_PUBLIC_DIR)) {
    fail(res, 404, 'Route not found', 'NOT_FOUND');
    return;
  }
  const requested = req.path === '/' ? 'index.html' : req.path.replace(/^\/+/, '');
  const target = path.resolve(FRONTEND_PUBLIC_DIR, requested);
  if (target.startsWith(path.resolve(FRONTEND_PUBLIC_DIR)) && fs.existsSync(target) && fs.statSync(target).isFile()) {
    res.sendFile(target);
    return;
  }
  res.sendFile(path.join(FRONTEND_PUBLIC_DIR, 'index.html'));
});

export default app;
