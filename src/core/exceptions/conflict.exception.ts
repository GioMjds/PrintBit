import { HttpException } from './http-exception';

/**
 * Exception for 409 Conflict errors.
 * Use when the request conflicts with the current state of the resource.
 */
export class ConflictException extends HttpException {
  constructor(
    message = 'Conflict',
    code?: string,
    details?: Record<string, unknown>,
  ) {
    super(409, message, code, details);
    this.name = 'ConflictException';
  }
}
