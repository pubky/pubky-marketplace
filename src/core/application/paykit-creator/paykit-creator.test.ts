import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PAYKIT_CREATOR_RATE_LIMIT_REQUESTS, PAYKIT_CREATOR_RATE_LIMIT_WINDOW_MS } from '@/config/paykit-creator';
import { Logger } from '@/libs/logger/logger';
import { NextJsPaykitCreatorService } from '@/services/nextjs/paykit-creator/paykit-creator';
import { PaykitCreatorRateLimiter } from '@/services/nextjs/paykit-creator/paykit-creator.rate-limit';
import { PaykitCreatorApplication } from './paykit-creator';

const creator = 'pubkygy1wnkhfwezwdnawnur1bc3kw1x3jf5ggjj3cm37e31i5ntq3pco';

describe('PaykitCreatorApplication.isCreatorHeld', () => {
  const serviceSpy = vi.spyOn(NextJsPaykitCreatorService, 'isCreatorHeld');

  beforeEach(() => {
    vi.clearAllMocks();
    PaykitCreatorRateLimiter.resetForTests();
    serviceSpy.mockResolvedValue({ ok: true, held: true });
  });

  it('asks the service with the creator alone', async () => {
    await expect(PaykitCreatorApplication.isCreatorHeld({ creator, rateLimitKeys: ['ip:a'] })).resolves.toEqual({
      ok: true,
      held: true,
    });
    expect(serviceSpy).toHaveBeenCalledWith({ creator });
  });

  it('refuses a caller past its allowance with a retry hint, without asking the service', async () => {
    for (let i = 0; i < PAYKIT_CREATOR_RATE_LIMIT_REQUESTS; i += 1) {
      await PaykitCreatorApplication.isCreatorHeld({ creator, rateLimitKeys: ['ip:a'] });
    }
    const logged = vi.spyOn(Logger, 'error').mockImplementation(() => {});

    await expect(PaykitCreatorApplication.isCreatorHeld({ creator, rateLimitKeys: ['ip:a'] })).resolves.toEqual({
      ok: false,
      reason: 'rate_limited',
      retryAfterSeconds: PAYKIT_CREATOR_RATE_LIMIT_WINDOW_MS / 1000,
    });
    expect(serviceSpy).toHaveBeenCalledTimes(PAYKIT_CREATOR_RATE_LIMIT_REQUESTS);
    // A local refusal is an expected answer, not an application error: nothing is logged or captured.
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
    await expect(PaykitCreatorApplication.isCreatorHeld({ creator, rateLimitKeys: ['ip:b'] })).resolves.toEqual({
      ok: true,
      held: true,
    });
  });
});
