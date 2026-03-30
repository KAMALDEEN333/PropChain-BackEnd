export enum ErrorCode {
  // =========================
  // General / Server
  // =========================
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',

  // =========================
  // Request / Validation
  // =========================
  BAD_REQUEST = 'BAD_REQUEST',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT = 'INVALID_FORMAT',
  UNPROCESSABLE_ENTITY = 'UNPROCESSABLE_ENTITY',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

  // =========================
  // Authentication
  // =========================
  UNAUTHORIZED = 'UNAUTHORIZED',
  AUTHENTICATION_REQUIRED = 'AUTHENTICATION_REQUIRED',

  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',

  // Backward-compatible / explicit auth errors
  AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS',
  AUTH_USER_NOT_FOUND = 'AUTH_USER_NOT_FOUND',
  AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',
  AUTH_TOKEN_INVALID = 'AUTH_TOKEN_INVALID',
  AUTH_ACCOUNT_LOCKED = 'AUTH_ACCOUNT_LOCKED',

  // =========================
  // Authorization
  // =========================
  FORBIDDEN = 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  ACCESS_DENIED = 'ACCESS_DENIED',

  // =========================
  // Resource / Conflict
  // =========================
  NOT_FOUND = 'NOT_FOUND',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  PROPERTY_NOT_FOUND = 'PROPERTY_NOT_FOUND',

  CONFLICT = 'CONFLICT',
  DUPLICATE_ENTRY = 'DUPLICATE_ENTRY',
  RESOURCE_ALREADY_EXISTS = 'RESOURCE_ALREADY_EXISTS',

  // =========================
  // Business Logic
  // =========================
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  BUSINESS_RULE_VIOLATION = 'BUSINESS_RULE_VIOLATION',
  OPERATION_NOT_ALLOWED = 'OPERATION_NOT_ALLOWED',
  INVALID_STATE = 'INVALID_STATE',

  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  EXTERNAL_API_ERROR = 'EXTERNAL_API_ERROR',
  CIRCUIT_OPEN = 'CIRCUIT_OPEN',

  // =========================
  // Transaction Management
  // =========================
  TRANSACTION_TIMEOUT = 'TRANSACTION_TIMEOUT',
  TRANSACTION_DEADLOCK = 'TRANSACTION_DEADLOCK',
  TRANSACTION_ROLLBACK = 'TRANSACTION_ROLLBACK',
  TRANSACTION_RETRY_EXHAUSTED = 'TRANSACTION_RETRY_EXHAUSTED',
  COMPENSATION_FAILED = 'COMPENSATION_FAILED',
}

export const ErrorMessages: Record<ErrorCode, string> = {
  // General / Server
  [ErrorCode.INTERNAL_SERVER_ERROR]: 'An unexpected error occurred. Please try again later',
  [ErrorCode.DATABASE_ERROR]: 'A database error occurred',
  [ErrorCode.EXTERNAL_SERVICE_ERROR]: 'An external service is currently unavailable',

  // Request / Validation
  [ErrorCode.BAD_REQUEST]: 'The request is invalid',
  [ErrorCode.VALIDATION_ERROR]: 'The provided data is invalid',
  [ErrorCode.INVALID_INPUT]: 'The input data contains invalid values',
  [ErrorCode.MISSING_REQUIRED_FIELD]: 'Required field is missing',
  [ErrorCode.INVALID_FORMAT]: 'The data format is incorrect',
  [ErrorCode.UNPROCESSABLE_ENTITY]: 'The request was well-formed but could not be processed',
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 'Too many requests. Please try again later',

  // Authentication
  [ErrorCode.UNAUTHORIZED]: 'You are not authorized to access this resource',
  [ErrorCode.AUTHENTICATION_REQUIRED]: 'Authentication is required to access this resource',

  [ErrorCode.INVALID_CREDENTIALS]: 'The provided credentials are invalid',
  [ErrorCode.TOKEN_EXPIRED]: 'Your session has expired. Please login again',
  [ErrorCode.TOKEN_INVALID]: 'Invalid authentication token',

  // Explicit / legacy auth errors
  [ErrorCode.AUTH_INVALID_CREDENTIALS]: 'Invalid credentials provided',
  [ErrorCode.AUTH_USER_NOT_FOUND]: 'User not found',
  [ErrorCode.AUTH_TOKEN_EXPIRED]: 'Authentication token has expired',
  [ErrorCode.AUTH_TOKEN_INVALID]: 'Authentication token is invalid',
  [ErrorCode.AUTH_ACCOUNT_LOCKED]: 'Your account has been locked for security reasons',

  // Authorization
  [ErrorCode.FORBIDDEN]: 'You do not have permission to perform this action',
  [ErrorCode.INSUFFICIENT_PERMISSIONS]: 'You lack the necessary permissions',
  [ErrorCode.ACCESS_DENIED]: 'Access to this resource is denied',

  // Resource / Conflict
  [ErrorCode.NOT_FOUND]: 'The requested resource was not found',
  [ErrorCode.RESOURCE_NOT_FOUND]: 'The specified resource does not exist',
  [ErrorCode.USER_NOT_FOUND]: 'User not found',
  [ErrorCode.PROPERTY_NOT_FOUND]: 'Property not found',

  [ErrorCode.CONFLICT]: 'A conflict occurred while processing your request',
  [ErrorCode.DUPLICATE_ENTRY]: 'This entry already exists',
  [ErrorCode.RESOURCE_ALREADY_EXISTS]: 'A resource with this identifier already exists',

  // Business Logic
  [ErrorCode.TRANSACTION_FAILED]: 'The transaction could not be completed',
  [ErrorCode.BUSINESS_RULE_VIOLATION]: 'This operation violates business rules',
  [ErrorCode.OPERATION_NOT_ALLOWED]: 'This operation is not allowed',
  [ErrorCode.INVALID_STATE]: 'The resource is in an invalid state for this operation',

  [ErrorCode.SERVICE_UNAVAILABLE]: 'The requested service is temporarily unavailable.',
  [ErrorCode.CIRCUIT_OPEN]: 'Circuit breaker is open. Please try again later.',
  [ErrorCode.EXTERNAL_API_ERROR]: 'An error occurred while communicating with an external service.',

  // Transaction Management
  [ErrorCode.TRANSACTION_TIMEOUT]: 'The database transaction timed out. Please try again.',
  [ErrorCode.TRANSACTION_DEADLOCK]: 'A deadlock was detected. The transaction was rolled back.',
  [ErrorCode.TRANSACTION_ROLLBACK]: 'The transaction was rolled back due to an error.',
  [ErrorCode.TRANSACTION_RETRY_EXHAUSTED]: 'Maximum transaction retry attempts exceeded.',
  [ErrorCode.COMPENSATION_FAILED]: 'A compensation action failed during transaction rollback.',
};
