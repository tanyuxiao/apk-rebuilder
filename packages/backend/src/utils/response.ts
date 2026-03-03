import type { Response } from 'express';
import type { ApiError, ApiSuccess } from '../models/result.js';

export function ok<T>(res: Response, data: T, status = 200): Response<ApiSuccess<T>> {
  return res.status(status).json({ success: true, data });
}

export function fail(
  res: Response,
  status: number,
  message: string,
  options?: { code?: string; details?: unknown }
): Response<ApiError> {
  return res.status(status).json({
    success: false,
    error: {
      message,
      code: options?.code,
      details: options?.details
    }
  });
}
