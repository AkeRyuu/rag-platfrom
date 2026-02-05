/**
 * Global Error Handler Middleware
 *
 * Converts errors into structured JSON responses.
 * Handles ZodError, AppError, and unknown errors.
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, wrapError } from '../utils/errors';
import { logger } from '../utils/logger';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  // Zod validation errors -> 400
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  // Known application errors -> use statusCode
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error(err.message, { code: err.code, stack: err.stack });
    }
    return res.status(err.statusCode).json(err.toJSON());
  }

  // Unknown errors -> wrap and return 500
  const wrapped = wrapError(err);
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    requestId: req.requestId,
  });

  return res.status(wrapped.statusCode).json(wrapped.toJSON());
}
