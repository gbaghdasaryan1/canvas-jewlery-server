import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * The frontend reads `.message` off every error body and branches on status.
 * Nest's default body is `{ statusCode, message, error }` where `message` may be
 * a string[] (ValidationPipe) — this flattens everything to `{ message: string }`.
 */
/** Plain number so comparisons don't trip no-unsafe-enum-comparison. */
const SERVER_ERROR_THRESHOLD = 500;

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    const status: number =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= SERVER_ERROR_THRESHOLD) {
      this.logger.error(exception);
    }

    response
      .status(status)
      .json({ message: this.resolveMessage(exception, status) });
  }

  private resolveMessage(exception: unknown, status: number): string {
    // Never leak internals on a 5xx.
    if (status >= SERVER_ERROR_THRESHOLD) {
      return 'Internal server error';
    }

    if (exception instanceof HttpException) {
      const body = exception.getResponse();

      if (typeof body === 'string') {
        return body;
      }

      const message = (body as { message?: unknown }).message;

      if (Array.isArray(message)) {
        return message.join('; ');
      }

      if (typeof message === 'string') {
        return message;
      }

      return exception.message;
    }

    return 'Unexpected error';
  }
}
