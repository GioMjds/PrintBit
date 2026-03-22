import { HttpException } from './http-exception';

/**
 * Exception for 401 Unauthorized errors.
 * Use when authentication is required but not provided or invalid.
 */
export class UnauthorizedException extends HttpException {
  constructor(
    message = 'Unauthorized',
    code?: string,
    details?: Record<string, unknown>,
  ) {
    super(401, message, code, details);
    this.name = 'UnauthorizedException';
  }
}
