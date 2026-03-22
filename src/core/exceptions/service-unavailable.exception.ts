import { HttpException } from './http-exception';

/**
 * Exception for 503 Service Unavailable errors.
 * Use when a service or dependency is temporarily unavailable.
 */
export class ServiceUnavailableException extends HttpException {
  constructor(
    message = 'Service Unavailable',
    code?: string,
    details?: Record<string, unknown>,
  ) {
    super(503, message, code, details);
    this.name = 'ServiceUnavailableException';
  }
}
