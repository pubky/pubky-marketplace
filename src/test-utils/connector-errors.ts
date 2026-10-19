import { AppError } from '@/libs/error/error';
import { ClientErrorCode, ServerErrorCode } from '@/libs/error/error.codes';
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

/** An error for a status the service answered without a refusal code, such as a route an older service does not have. */
export function bareHttpFailure(statusCode: number): AppError {
  const common = {
    message: `HTTP ${statusCode}`,
    service: ErrorService.Marketplace,
    operation: 'connector',
    context: { statusCode },
  };
  return statusCode >= 500
    ? new AppError({ ...common, category: ErrorCategory.Server, code: ServerErrorCode.SERVICE_UNAVAILABLE })
    : new AppError({ ...common, category: ErrorCategory.Client, code: ClientErrorCode.NOT_FOUND });
}
