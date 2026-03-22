import { HttpException } from './http-exception';

/**
 * Exception for 404 Not Found errors.
 * Use when the requested resource does not exist.
 */
export class NotFoundException extends HttpException {
  constructor(
    message = 'Not Found',
    code?: string,
    details?: Record<string, unknown>,
  ) {
    super(404, message, code, details);
    this.name = 'NotFoundException';
  }
}
