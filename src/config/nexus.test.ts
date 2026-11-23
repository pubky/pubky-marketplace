import { afterEach, describe, expect, it, vi } from 'vitest';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { Logger } from '@/libs/logger/logger';
import {
  getCdnUrlIfConfigured,
  getMarketplaceNexusUrlIfConfigured,
  getNexusUrlIfConfigured,
} from '@/libs/runtime-config/runtime-config';
import { getCdnUrl, getMarketplaceNexusUrl, getNexusUrl } from './nexus';

vi.mock('@/libs/runtime-config/runtime-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/runtime-config/runtime-config')>();
  return {
    ...actual,
    getNexusUrlIfConfigured: vi.fn(actual.getNexusUrlIfConfigured),
    getCdnUrlIfConfigured: vi.fn(actual.getCdnUrlIfConfigured),
    getMarketplaceNexusUrlIfConfigured: vi.fn(actual.getMarketplaceNexusUrlIfConfigured),
  };
});

describe('index URL getters', () => {
  const logError = vi.spyOn(Logger, 'error').mockImplementation(() => {});

  afterEach(() => {
    vi.mocked(getNexusUrlIfConfigured).mockReset();
    vi.mocked(getCdnUrlIfConfigured).mockReset();
    vi.mocked(getMarketplaceNexusUrlIfConfigured).mockReset();
    logError.mockClear();
  });

  it('return the configured URLs', () => {
    vi.mocked(getNexusUrlIfConfigured).mockReturnValue('https://nexus.example.com');
    vi.mocked(getCdnUrlIfConfigured).mockReturnValue('https://cdn.example.com');
    vi.mocked(getMarketplaceNexusUrlIfConfigured).mockReturnValue('https://marketplace-nexus.example.com');

    expect(getNexusUrl()).toBe('https://nexus.example.com');
    expect(getCdnUrl()).toBe('https://cdn.example.com');
    expect(getMarketplaceNexusUrl()).toBe('https://marketplace-nexus.example.com');
    expect(logError).not.toHaveBeenCalled();
  });

  it('refuse a read in a store, whose config holds none, and report it once through the error factory', () => {
    vi.mocked(getNexusUrlIfConfigured).mockReturnValue(undefined);
    vi.mocked(getCdnUrlIfConfigured).mockReturnValue(undefined);
    vi.mocked(getMarketplaceNexusUrlIfConfigured).mockReturnValue(undefined);

    expect(() => getNexusUrl()).toThrow(
      expect.objectContaining({
        name: 'AppError',
        category: ErrorCategory.Validation,
        code: ValidationErrorCode.MISSING_FIELD,
        service: ErrorService.Nexus,
        operation: 'getNexusUrl',
      }),
    );
    expect(logError).toHaveBeenCalledTimes(1);
    expect(() => getCdnUrl()).toThrow('PUBKY_RUNTIME_CDN_URL');
    expect(() => getMarketplaceNexusUrl()).toThrow('PUBKY_RUNTIME_MARKETPLACE_NEXUS_URL');
    expect(logError).toHaveBeenCalledTimes(3);
  });
});
