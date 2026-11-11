export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'CODE_EXPIRED'
  | 'CODE_INVALID'
  | 'PROVIDER_DISABLED'
  | 'PROVIDER_ERROR'
  | 'PAYMENT_INVALID'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  CODE_EXPIRED: 410,
  CODE_INVALID: 422,
  PROVIDER_DISABLED: 503,
  PROVIDER_ERROR: 502,
  PAYMENT_INVALID: 400,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
    if (details !== undefined) this.details = details;
  }

  static validation(message: string, details?: unknown): AppError {
    return new AppError('VALIDATION_FAILED', message, details);
  }

  static unauthorized(message = '请先登录'): AppError {
    return new AppError('UNAUTHORIZED', message);
  }

  static conflict(message: string): AppError {
    return new AppError('CONFLICT', message);
  }

  static notFound(message = '资源不存在'): AppError {
    return new AppError('NOT_FOUND', message);
  }
}
