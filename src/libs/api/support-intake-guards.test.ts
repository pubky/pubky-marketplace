import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORT_INTAKE_LIMITS, SUPPORT_INTAKE_RATE_LIMIT_WINDOW_MS } from '@/config/support-intake';
import { Logger } from '@/libs/logger/logger';
import { admitSupportIntake, resetSupportIntakeForTests } from './support-intake-guards';

function requestFrom(clientIp?: string) {
  const headers: Record<string, string> = clientIp ? { 'x-forwarded-for': clientIp } : {};
  return new NextRequest('http://localhost:3000/api/feedback', { method: 'POST', headers });
}

function admitTimes(times: number, clientIp?: string) {
  return Array.from({ length: times }, () => admitSupportIntake('feedback', requestFrom(clientIp)));
}

describe('support intake guards', () => {
  beforeEach(() => {
    resetSupportIntakeForTests();
    vi.stubEnv('VERCEL', undefined);
    vi.stubEnv('SHOP_BFF_CLI_TRUSTED_PROXY_COUNT', '1');
    vi.spyOn(Logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('refuses a request once the client window is used up', () => {
    const admitted = admitTimes(SUPPORT_INTAKE_LIMITS.feedback.perClientRequests, '203.0.113.7');
    expect(admitted.every((decision) => decision.ok)).toBe(true);

    const refused = admitSupportIntake('feedback', requestFrom('203.0.113.7'));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);

    expect(admitSupportIntake('feedback', requestFrom('203.0.113.8')).ok).toBe(true);
  });

  it('spends no shared quota on requests the client window refuses', () => {
    admitTimes(SUPPORT_INTAKE_LIMITS.feedback.perClientRequests + 50, '203.0.113.7');

    // Requests without a trusted address count only against the shared window.
    const remaining = SUPPORT_INTAKE_LIMITS.feedback.globalRequests - SUPPORT_INTAKE_LIMITS.feedback.perClientRequests;
    expect(admitTimes(remaining).every((decision) => decision.ok)).toBe(true);
    expect(admitSupportIntake('feedback', requestFrom()).ok).toBe(false);
  });

  it('refuses every client once the shared window is used up', () => {
    admitTimes(SUPPORT_INTAKE_LIMITS.feedback.globalRequests);

    const refused = admitSupportIntake('feedback', requestFrom('198.51.100.1'));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('spends no client quota on requests the shared window refuses', () => {
    vi.useFakeTimers();
    const { perClientRequests, globalRequests } = SUPPORT_INTAKE_LIMITS.feedback;
    admitTimes(globalRequests);

    // Halfway through the shared window, so a client window opened now would outlive it.
    vi.advanceTimersByTime(SUPPORT_INTAKE_RATE_LIMIT_WINDOW_MS / 2);
    const refused = admitTimes(perClientRequests + 1, '198.51.100.1');
    expect(refused.every((decision) => !decision.ok)).toBe(true);

    vi.advanceTimersByTime(SUPPORT_INTAKE_RATE_LIMIT_WINDOW_MS / 2);

    const admitted = admitTimes(perClientRequests, '198.51.100.1');
    expect(admitted.every((decision) => decision.ok)).toBe(true);
    expect(admitSupportIntake('feedback', requestFrom('198.51.100.1')).ok).toBe(false);
  });

  it('applies only the shared window when no trusted client address is available', () => {
    vi.stubEnv('SHOP_BFF_CLI_TRUSTED_PROXY_COUNT', undefined);

    // An untrusted forwarded address is ignored, and unknown clients are not pooled under one client window.
    const admitted = admitTimes(SUPPORT_INTAKE_LIMITS.feedback.globalRequests, '203.0.113.7');
    expect(admitted.every((decision) => decision.ok)).toBe(true);
    expect(admitSupportIntake('feedback', requestFrom('203.0.113.7')).ok).toBe(false);
  });

  it('warns once per process, without client addresses, that per-client limits are off', () => {
    vi.stubEnv('SHOP_BFF_CLI_TRUSTED_PROXY_COUNT', undefined);

    admitTimes(3, '203.0.113.7');
    expect(Logger.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(Logger.warn).mock.calls)).not.toContain('203.0.113.7');

    resetSupportIntakeForTests();
    admitTimes(1);
    expect(Logger.warn).toHaveBeenCalledTimes(2);
  });

  it('keeps the windows of each form apart', () => {
    admitTimes(SUPPORT_INTAKE_LIMITS.feedback.perClientRequests + 1, '203.0.113.7');

    expect(admitSupportIntake('report', requestFrom('203.0.113.7')).ok).toBe(true);
    expect(admitSupportIntake('copyright', requestFrom('203.0.113.7')).ok).toBe(true);
  });

  it('admits the client again once its window has passed', () => {
    vi.useFakeTimers();
    admitTimes(SUPPORT_INTAKE_LIMITS.feedback.perClientRequests + 1, '203.0.113.7');
    expect(admitSupportIntake('feedback', requestFrom('203.0.113.7')).ok).toBe(false);

    vi.advanceTimersByTime(SUPPORT_INTAKE_RATE_LIMIT_WINDOW_MS);

    expect(admitSupportIntake('feedback', requestFrom('203.0.113.7')).ok).toBe(true);
  });
});
