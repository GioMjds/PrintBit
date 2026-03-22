/**
 * Base HTTP exception class for all API errors.
 * Provides a consistent error structure across the application.
 */
export class HttpException extends Error {
  public readonly statusCode: number;
  public readonly code: string | undefined;
  public readonly details: Record<string, unknown> | undefined;

  constructor(
    statusCode: number,
    message: string,
    code?: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpException';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);

    // Capture stack trace (V8 environments)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert exception to a JSON-serializable response object.
   */
  toJSON(): {
    error: string;
    statusCode: number;
    code?: string;
    details?: Record<string, unknown>;
  } {
    const response: {
      error: string;
      statusCode: number;
      code?: string;
      details?: Record<string, unknown>;
    } = {
      error: this.message,
      statusCode: this.statusCode,
    };

    if (this.code) {
      response.code = this.code;
    }

    if (this.details && Object.keys(this.details).length > 0) {
      response.details = this.details;
    }

    return response;
  }
}
