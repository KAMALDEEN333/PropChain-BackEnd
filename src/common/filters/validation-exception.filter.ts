import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { ErrorResponseDto } from '../errors/error.dto';

@Catch(BadRequestException)
export class ValidationExceptionFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    let message = 'Validation failed';
    let details: string[] = [];

    if (typeof exceptionResponse === 'object' && (exceptionResponse as any).message) {
      const msg = (exceptionResponse as any).message;
      if (Array.isArray(msg)) {
        details = msg;
        message = 'One or more validation errors occurred';
      } else {
        message = msg;
      }
    }

    const errorResponse = new ErrorResponseDto({
      statusCode: status,
      errorCode: 'VALIDATION_ERROR',
      message: message,
      details: details,
      path: request.url,
      timestamp: new Date().toISOString(),
      requestId: request.headers['x-correlation-id'] as string || (request as any).id,
    });

    response.status(status).json(errorResponse);
  }
}
