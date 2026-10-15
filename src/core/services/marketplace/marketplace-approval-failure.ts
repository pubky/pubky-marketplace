import { AppError } from '@/libs/error/error';
import { AuthErrorCode, ClientErrorCode, ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';

/** Expected approval states are control flow, not failed-service telemetry. */
export function marketplaceApprovalFailure(message: string, operation: string, status?: number): AppError {
  const common = { message, service: ErrorService.Marketplace, operation, context: { statusCode: status } };
  if (
    (status === undefined || status === 401) &&
    (message === 'shop_session_missing' || message === 'shop_session_expired')
  ) {
    return new AppError({ ...common, category: ErrorCategory.Auth, code: AuthErrorCode.SESSION_EXPIRED });
  }
  if ((status === undefined || status === 409) && message === 'claim_in_progress') {
    return new AppError({ ...common, category: ErrorCategory.Client, code: ClientErrorCode.CONFLICT });
  }
  if ((status === undefined || status === 410) && (message === 'flow_expired' || message === 'flow_cancelled')) {
    return new AppError({ ...common, category: ErrorCategory.Client, code: ClientErrorCode.GONE });
  }
  return Err.server(ServerErrorCode.SERVICE_UNAVAILABLE, message, common);
}
