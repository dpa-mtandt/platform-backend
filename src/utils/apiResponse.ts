import type { Response } from 'express';

/** Consistent success envelope: { success: true, message?, data }. */
export function ok<T>(res: Response, data: T, message?: string, statusCode = 200): Response {
  return res.status(statusCode).json({ success: true, message, data });
}

export function created<T>(res: Response, data: T, message = 'Created'): Response {
  return ok(res, data, message, 201);
}

export function noContent(res: Response): Response {
  return res.status(204).send();
}
