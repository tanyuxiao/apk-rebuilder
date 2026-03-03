import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { authEnabled, authToken } from '../config/env.js';
import { fail } from '../utils/response.js';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function extractToken(req: Request): string {
  const auth = req.header('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const headerToken = (req.header('x-api-key') || '').trim();
  if (headerToken) {
    return headerToken;
  }
  const q = req.query?.api_key;
  if (typeof q === 'string') {
    return q.trim();
  }
  return '';
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!authEnabled || !authToken) {
    next();
    return;
  }

  const incoming = extractToken(req);
  if (!incoming || !safeEqual(incoming, authToken)) {
    fail(res, 401, 'Unauthorized', { code: 'UNAUTHORIZED' });
    return;
  }

  next();
}
