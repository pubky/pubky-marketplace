import { afterEach, describe, expect, it, vi } from 'vitest';
import { Err } from '@/libs/error/error.factories';
import { ErrorCategory } from '@/libs/error/error.types';
import { marketplaceApprovalFailure } from './marketplace-approval-failure';

afterEach(() => vi.restoreAllMocks());
describe('expected approval states', () => {
  it.each([
    ['shop_session_missing', 401, ErrorCategory.Auth],
    ['shop_session_expired', 401, ErrorCategory.Auth],
    ['claim_in_progress', 409, ErrorCategory.Client],
    ['flow_expired', 410, ErrorCategory.Client],
    ['flow_cancelled', 410, ErrorCategory.Client],
  ] as const)('keeps %s out of the logging and Sentry factory', (code, status, category) => {
    const report = vi.spyOn(Err, 'server');
    const error = marketplaceApprovalFailure(code, 'marketplaceBootstrap', status);
    expect(error.message).toBe(code);
    expect(error.category).toBe(category);
    expect(report).not.toHaveBeenCalled();
  });
  it.each([
    ['shop_session_missing', 503],
    ['unknown_failure', 409],
  ] as const)('still reports unexpected %s HTTP %s', (code, status) => {
    const report = vi.spyOn(Err, 'server');
    expect(marketplaceApprovalFailure(code, 'marketplaceBootstrap', status).category).toBe(ErrorCategory.Server);
    expect(report).toHaveBeenCalledOnce();
  });
});
