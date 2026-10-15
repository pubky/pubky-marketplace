import { TimeoutErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import type { ErrorService } from '@/libs/error/error.types';

export const AUTH_IO_TIMEOUT_MS = 15_000;

/**
 * Bounds one IO result, including response-body reads. Native fetch callers
 * must use the signal. SDK calls cannot be canceled, so use this only around
 * their individual IO steps, never an application workflow with later writes.
 * A late result/rejection is consumed and cannot resume the awaiting caller.
 */
export async function withIoDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  options: { service: ErrorService; operation: string; timeoutMs: number },
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = Err.timeout(TimeoutErrorCode.REQUEST_TIMEOUT, 'The request took too long. Please retry.', {
        service: options.service,
        operation: options.operation,
        context: { timeoutMs: options.timeoutMs },
      });
      reject(error);
      controller.abort(error);
    }, options.timeoutMs);
  });
  try {
    return await Promise.race([work(controller.signal), deadline]);
  } finally {
    clearTimeout(timer!);
  }
}
