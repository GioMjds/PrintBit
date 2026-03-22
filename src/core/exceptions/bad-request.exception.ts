import { HttpException } from './http-exception';

/**
 * Exception for 400 Bad Request errors.
 * Use when the request is malformed or contains invalid data.
 */
export class BadRequestException extends HttpException {
  constructor(
    message = 'Bad Request',
    code?: string,
    details?: Record<string, unknown>,
  ) {
    super(400, message, code, details);
    this.name = 'BadRequestException';
  }
}
