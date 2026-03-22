import { HttpException } from './http-exception';

/**
 * Exception for 422 Unprocessable Entity errors.
 * Use when the request is well-formed but contains semantic errors.
 */
export class UnprocessableEntityException extends HttpException {
  constructor(
    message = 'Unprocessable Entity',
    code?: string,
    details?: Record<string, unknown>,
  ) {
    super(422, message, code, details);
    this.name = 'UnprocessableEntityException';
  }
}
