import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../models/error.js';
import { fail } from '../utils/response.js';

export function notFoundHandler(req: Request, res: Response): void {
  fail(res, 404, `Route not found: ${req.method} ${req.path}`, { code: 'NOT_FOUND' });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) {
    return;
  }

  if (err instanceof HttpError) {
    fail(res, err.status, err.message, { code: err.code, details: err.details });
    return;
  }

  if (err instanceof Error) {
    fail(res, 500, err.message, { code: 'INTERNAL_ERROR' });
    return;
  }

  fail(res, 500, String(err), { code: 'INTERNAL_ERROR' });
}
