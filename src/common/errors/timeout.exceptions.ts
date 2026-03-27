import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Custom exceptions for timeout-related errors
 */
export class OperationTimeoutException extends HttpException {
  constructor(operation: string, timeoutMs: number) {
    super(
      {
        statusCode: HttpStatus.REQUEST_TIMEOUT,
        message: `Operation '${operation}' timed out after ${timeoutMs}ms`,
        error: 'Operation Timeout',
        timestamp: new Date().toISOString(),
      },
      HttpStatus.REQUEST_TIMEOUT
    );
  }
}

export class DatabaseTimeoutException extends HttpException {
  constructor(query: string, timeoutMs: number) {
    super(
      {
        statusCode: HttpStatus.REQUEST_TIMEOUT,
        message: `Database query '${query}' timed out after ${timeoutMs}ms`,
        error: 'Database Timeout',
        timestamp: new Date().toISOString(),
      },
      HttpStatus.REQUEST_TIMEOUT
    );
  }
}

export class ExternalServiceTimeoutException extends HttpException {
  constructor(service: string, timeoutMs: number) {
    super(
      {
        statusCode: HttpStatus.REQUEST_TIMEOUT,
        message: `External service '${service}' request timed out after ${timeoutMs}ms`,
        error: 'External Service Timeout',
        timestamp: new Date().toISOString(),
      },
      HttpStatus.REQUEST_TIMEOUT
    );
  }
}
