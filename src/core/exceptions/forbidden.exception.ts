import { HttpException } from './http-exception';

/**
 * Exception for 403 Forbidden errors.
 * Use when the user is authenticated but lacks permission for the action.
 */
export class ForbiddenException extends HttpException {
  constructor(
    message = 'Forbidden',
    code?: string,
    details?: Record<string, unknown>,
  ) {
    super(403, message, code, details);
    this.name = 'ForbiddenException';
  }
}
