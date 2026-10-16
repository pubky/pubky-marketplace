import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { HttpMethod } from '@/libs/http/http.types';
import { Logger } from '@/libs/logger/logger';
import type { Pubky } from '@/models/models.types';
import { SettingsNormalizer } from '@/pipes/settings/settings.normalizer';
import { HomeserverService } from '@/services/homeserver/homeserver';
import {
  defaultNotificationPreferences,
  defaultPrivacyPreferences,
  type SettingsState,
} from '@/stores/settings/settings.types';
import { SettingsApplication } from './settings';

// Mock the HomeserverService
vi.mock('@/services/homeserver/homeserver', () => ({
  HomeserverService: {
    request: vi.fn(),
    getJsonIfFound: vi.fn(),
  },
}));

// Mock the SettingsNormalizer
vi.mock('@/pipes/settings/settings.normalizer', () => ({
  SettingsNormalizer: {
    to: vi.fn(),
    from: vi.fn(),
    buildUrl: vi.fn(),
  },
}));

describe('SettingsApplication', () => {
  const testPubky = 'o1gg96ewuojmopcjbz8895478wdtxtzzuxnfjjz8o8e77csa1ngo' as Pubky;

  // Test data factory
  const createMockSettingsState = (overrides?: Partial<SettingsState>): SettingsState => ({
    notifications: defaultNotificationPreferences,
    privacy: defaultPrivacyPreferences,
    muted: [],
    updatedAt: 1700000000000,
    version: 1,
    ...overrides,
  });

  const createMockNormalizerResult = (settings: SettingsState) => ({
    settings: {
      notifications: settings.notifications,
      privacy: settings.privacy,
      updatedAt: settings.updatedAt,
      version: settings.version,
    },
    meta: {
      url: `pubky://${testPubky}/pub/pubky.app/settings.json`,
      path: 'pub/pubky.app/settings.json',
    },
  });

  // Helper functions
  const setupMocks = () => {
    // Spy on Logger methods
    vi.spyOn(Logger, 'debug').mockImplementation(() => {});
    vi.spyOn(Logger, 'info').mockImplementation(() => {});
    vi.spyOn(Logger, 'error').mockImplementation(() => {});

    return {
      requestSpy: vi.spyOn(HomeserverService, 'request'),
      readSpy: vi.spyOn(HomeserverService, 'getJsonIfFound'),
      normalizerToSpy: vi.spyOn(SettingsNormalizer, 'to'),
      normalizerFromSpy: vi.spyOn(SettingsNormalizer, 'from'),
      normalizerBuildUrlSpy: vi.spyOn(SettingsNormalizer, 'buildUrl'),
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('commitUpdate', () => {
    it('should sync settings to homeserver successfully', async () => {
      const settings = createMockSettingsState();
      const normalizerResult = createMockNormalizerResult(settings);
      const { requestSpy, normalizerToSpy } = setupMocks();

      normalizerToSpy.mockReturnValue(normalizerResult);
      requestSpy.mockResolvedValue(undefined);

      await SettingsApplication.commitUpdate(settings, testPubky);

      expect(normalizerToSpy).toHaveBeenCalledWith(settings, testPubky);
      expect(requestSpy).toHaveBeenCalledWith({
        method: HttpMethod.PUT,
        url: normalizerResult.meta.url,
        bodyJson: expect.any(Object),
      });
    });

    it('should throw error when homeserver request fails', async () => {
      const settings = createMockSettingsState();
      const normalizerResult = createMockNormalizerResult(settings);
      const { requestSpy, normalizerToSpy } = setupMocks();

      normalizerToSpy.mockReturnValue(normalizerResult);
      requestSpy.mockRejectedValue(new Error('Network error'));

      await expect(SettingsApplication.commitUpdate(settings, testPubky)).rejects.toThrow('Network error');
    });
  });

  describe('fetchFromHomeserver', () => {
    it('should fetch and return settings from homeserver', async () => {
      const remoteSettings = createMockSettingsState({ version: 2 });
      const { readSpy, normalizerBuildUrlSpy, normalizerFromSpy } = setupMocks();

      normalizerBuildUrlSpy.mockReturnValue(`pubky://${testPubky}/pub/pubky.app/settings.json`);
      readSpy.mockResolvedValue({
        found: true,
        json: {
          notifications: remoteSettings.notifications,
          privacy: remoteSettings.privacy,
          updatedAt: remoteSettings.updatedAt,
          version: remoteSettings.version,
        },
      });
      normalizerFromSpy.mockReturnValue(remoteSettings);

      const result = await SettingsApplication.fetchFromHomeserver(testPubky);

      expect(normalizerBuildUrlSpy).toHaveBeenCalledWith(testPubky);
      expect(readSpy).toHaveBeenCalledWith({ url: `pubky://${testPubky}/pub/pubky.app/settings.json` });
      expect(result).toEqual(remoteSettings);
    });

    it('should return null when homeserver returns empty response', async () => {
      const { readSpy, normalizerBuildUrlSpy } = setupMocks();

      normalizerBuildUrlSpy.mockReturnValue(`pubky://${testPubky}/pub/pubky.app/settings.json`);
      readSpy.mockResolvedValue({ found: true, json: undefined });

      const result = await SettingsApplication.fetchFromHomeserver(testPubky);

      expect(result).toBeNull();
    });

    it('should return null without an error when the settings file is missing', async () => {
      const { readSpy, normalizerBuildUrlSpy } = setupMocks();

      normalizerBuildUrlSpy.mockReturnValue(`pubky://${testPubky}/pub/pubky.app/settings.json`);
      readSpy.mockResolvedValue({ found: false });

      const result = await SettingsApplication.fetchFromHomeserver(testPubky);

      expect(result).toBeNull();
      expect(Logger.error).not.toHaveBeenCalled();
    });

    it('should throw on non-404 errors', async () => {
      const { readSpy, normalizerBuildUrlSpy } = setupMocks();
      const serverError = Err.server(ServerErrorCode.INTERNAL_ERROR, 'Server error', {
        service: ErrorService.Homeserver,
        operation: 'getJsonIfFound',
        context: { statusCode: 500 },
      });

      normalizerBuildUrlSpy.mockReturnValue(`pubky://${testPubky}/pub/pubky.app/settings.json`);
      readSpy.mockRejectedValue(serverError);

      await expect(SettingsApplication.fetchFromHomeserver(testPubky)).rejects.toThrow('Server error');
    });
  });

  describe('initializeSettings', () => {
    it('should create settings on homeserver when none exist remotely and return timestamped settings', async () => {
      const localSettings = createMockSettingsState({ updatedAt: 0 });
      const { readSpy, requestSpy, normalizerBuildUrlSpy, normalizerToSpy } = setupMocks();

      normalizerBuildUrlSpy.mockReturnValue(`pubky://${testPubky}/pub/pubky.app/settings.json`);
      readSpy.mockResolvedValueOnce({ found: false });
      normalizerToSpy.mockReturnValue(createMockNormalizerResult(localSettings));
      requestSpy.mockResolvedValueOnce(undefined); // commitUpdate succeeds

      const before = Date.now();
      const result = await SettingsApplication.initializeSettings(testPubky, localSettings);
      const after = Date.now();

      expect(result).not.toBeNull();
      expect(result!.updatedAt).toBeGreaterThanOrEqual(before);
      expect(result!.updatedAt).toBeLessThanOrEqual(after);
      expect(normalizerToSpy).toHaveBeenCalledWith(
        expect.objectContaining({ updatedAt: expect.any(Number) }),
        testPubky,
      );
      // Should push local settings to homeserver (calling commitUpdate())
      expect(requestSpy).toHaveBeenCalledWith(expect.objectContaining({ method: HttpMethod.PUT }));
    });

    it('should return remote settings when they are newer (higher version)', async () => {
      const localSettings = createMockSettingsState({ version: 1, updatedAt: 1700000000000 });
      const remoteSettings = createMockSettingsState({ version: 2, updatedAt: 1700000000000 });
      const { readSpy, normalizerBuildUrlSpy, normalizerFromSpy } = setupMocks();

      normalizerBuildUrlSpy.mockReturnValue(`pubky://${testPubky}/pub/pubky.app/settings.json`);
      readSpy.mockResolvedValue({ found: true, json: remoteSettings });
      normalizerFromSpy.mockReturnValue(remoteSettings);

      const result = await SettingsApplication.initializeSettings(testPubky, localSettings);

      expect(result).toEqual(remoteSettings);
    });

    it('should return remote settings when they are newer (same version, newer timestamp)', async () => {
      const localSettings = createMockSettingsState({ version: 1, updatedAt: 1700000000000 });
      const remoteSettings = createMockSettingsState({ version: 1, updatedAt: 1800000000000 });
      const { readSpy, normalizerBuildUrlSpy, normalizerFromSpy } = setupMocks();

      normalizerBuildUrlSpy.mockReturnValue(`pubky://${testPubky}/pub/pubky.app/settings.json`);
      readSpy.mockResolvedValue({ found: true, json: remoteSettings });
      normalizerFromSpy.mockReturnValue(remoteSettings);

      const result = await SettingsApplication.initializeSettings(testPubky, localSettings);

      expect(result).toEqual(remoteSettings);
    });

    it('should sync local settings when they are newer', async () => {
      const localSettings = createMockSettingsState({ version: 2, updatedAt: 1800000000000 });
      const remoteSettings = createMockSettingsState({ version: 1, updatedAt: 1700000000000 });
      const normalizerResult = createMockNormalizerResult(localSettings);
      const { readSpy, requestSpy, normalizerBuildUrlSpy, normalizerFromSpy, normalizerToSpy } = setupMocks();

      normalizerBuildUrlSpy.mockReturnValue(`pubky://${testPubky}/pub/pubky.app/settings.json`);
      readSpy.mockResolvedValueOnce({ found: true, json: remoteSettings });
      normalizerFromSpy.mockReturnValue(remoteSettings);
      normalizerToSpy.mockReturnValue(normalizerResult);
      requestSpy.mockResolvedValueOnce(undefined); // commitUpdate

      const result = await SettingsApplication.initializeSettings(testPubky, localSettings);

      expect(result).toBeNull();
      expect(normalizerToSpy).toHaveBeenCalledWith(localSettings, testPubky);
    });

    it('should throw on error', async () => {
      const localSettings = createMockSettingsState();
      const { normalizerBuildUrlSpy, readSpy } = setupMocks();

      normalizerBuildUrlSpy.mockReturnValue(`pubky://${testPubky}/pub/pubky.app/settings.json`);
      readSpy.mockRejectedValue(new Error('Network error'));

      await expect(SettingsApplication.initializeSettings(testPubky, localSettings)).rejects.toThrow('Network error');
    });
  });
});
