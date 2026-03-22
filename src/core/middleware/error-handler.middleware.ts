import type { Request, Response, NextFunction } from 'express';
import { HttpException } from '../exceptions';

/**
 * Global error handling middleware.
 * Catches HttpException instances and unknown errors,
 * returning consistent JSON error responses.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Handle known HTTP exceptions
  if (err instanceof HttpException) {
    res.status(err.statusCode).json(err.toJSON());
    return;
  }

  // Handle standard Error objects
  if (err instanceof Error) {
    console.error('[ERROR_HANDLER] Unhandled error:', {
      name: err.name,
      message: err.message,
      stack: err.stack,
    });

    res.status(500).json({
      error: 'Internal Server Error',
      statusCode: 500,
    });
    return;
  }

  // Handle unknown error types
  console.error('[ERROR_HANDLER] Unknown error type:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    statusCode: 500,
  });
}

/**
 * Async route handler wrapper.
 * Catches rejected promises and forwards them to the error handler.
 */
export function asyncHandler<T>(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<T>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
