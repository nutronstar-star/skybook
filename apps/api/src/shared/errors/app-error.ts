import { ErrorCode, type ErrorCodeType } from '@skybook/shared';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCodeType;
  public readonly details?: unknown;

  constructor(statusCode: number, code: ErrorCodeType, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(code: ErrorCodeType, message: string, details?: unknown): AppError {
    return new AppError(400, code, message, details);
  }

  static unauthorized(message = 'Authentication required'): AppError {
    return new AppError(401, ErrorCode.UNAUTHORIZED, message);
  }

  static notFound(message = 'Resource not found'): AppError {
    return new AppError(404, ErrorCode.NOT_FOUND, message);
  }

  static conflict(code: ErrorCodeType, message: string, details?: unknown): AppError {
    return new AppError(409, code, message, details);
  }

  static tooManyRequests(message = 'Rate limit exceeded'): AppError {
    return new AppError(429, ErrorCode.RATE_LIMIT_EXCEEDED, message);
  }

  static serviceUnavailable(code: ErrorCodeType, message: string): AppError {
    return new AppError(503, code, message);
  }
}