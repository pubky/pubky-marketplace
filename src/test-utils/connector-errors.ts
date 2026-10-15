import { AppError } from '@/libs/error/error';
import { ClientErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';

/** An error as the connector service calls throw it: the service's own refusal code in `context.reason`. */
export function connectorRefusal(reason: string, statusCode = 409, extra: Record<string, unknown> = {}): AppError {
  return new AppError({
    category: ErrorCategory.Client,
    code: ClientErrorCode.CONFLICT,
    message: 'The service refused the request.',
    service: ErrorService.Marketplace,
    operation: 'connector',
    context: { reason, statusCode, ...extra },
  });
}
