/** Application error carrying an HTTP status code and optional detail payload. */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Object.setPrototypeOf(this, ApiError.prototype);
    Error.captureStackTrace?.(this, this.constructor);
  }

  static badRequest(msg = 'Bad request', details?: unknown) {
    return new ApiError(400, msg, details);
  }
  static unauthorized(msg = 'Unauthorized') {
    return new ApiError(401, msg);
  }
  static forbidden(msg = 'Forbidden') {
    return new ApiError(403, msg);
  }
  static notFound(msg = 'Resource not found') {
    return new ApiError(404, msg);
  }
  static conflict(msg = 'Conflict', details?: unknown) {
    return new ApiError(409, msg, details);
  }
  static tooMany(msg = 'Too many requests') {
    return new ApiError(429, msg);
  }
  static serviceUnavailable(msg = 'Service unavailable') {
    return new ApiError(503, msg);
  }
  static internal(msg = 'Internal server error') {
    return new ApiError(500, msg);
  }
}
