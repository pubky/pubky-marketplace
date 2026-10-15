/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { register } from './instrumentation';

const mocks = vi.hoisted(() => ({
  config: { embedded: true },
  validate: vi.fn(),
  warn: vi.fn(),
  sentry: vi.fn(),
}));
vi.mock('@sentry/nextjs', () => ({ captureRequestError: vi.fn() }));
vi.mock('@/libs/runtime-config/runtime-config', () => ({
  getRuntimeConfig: () => mocks.config,
  warnIfModerationDisabled: mocks.warn,
}));
vi.mock('@/server/marketplace-grant/readiness', () => ({ assertEmbeddedShopDeployment: mocks.validate }));
vi.mock('./sentry.server.config', () => {
  mocks.sentry();
  return {};
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.validate.mockReset();
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('embedded Shop startup validation', () => {
  it('validates before serving requests at Node startup', async () => {
    await register();
    expect(mocks.validate).toHaveBeenCalledExactlyOnceWith(mocks.config);
    expect(mocks.warn).toHaveBeenCalledWith(mocks.config);
  });

  it('fails startup rather than serving a dead-end Shop when configuration is invalid', async () => {
    mocks.validate.mockImplementation(() => {
      throw new Error('sanitized config failure');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process exited');
    });
    await expect(register()).rejects.toThrow('process exited');
    expect(exit).toHaveBeenCalledWith(1);
    expect(mocks.warn).not.toHaveBeenCalled();
  });
});
