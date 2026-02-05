/**
 * Async Handler - Wraps async route handlers to forward errors to Express error middleware.
 *
 * Eliminates the need for try/catch blocks in every route handler.
 */

import { Request, Response, NextFunction } from 'express';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export function asyncHandler(fn: AsyncRequestHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
