import type { Session } from '@synonymdev/pubky';
import { vi } from 'vitest';
import { AuthApplication } from '@/application/auth/auth';
import { BootstrapApplication } from '@/application/bootstrap/bootstrap';
import { SettingsApplication } from '@/application/settings/settings';
import { SHOP_GRANT_CLIENT_ID } from '@/config/app';
import { NotificationNormalizer } from '@/pipes/notification/notification.normalizer';
import { clearPersistedAuthIdentity } from '@/stores/auth/auth.persisted';
import { useAuthStore } from '@/stores/auth/auth.store';
import { authInitialState } from '@/stores/auth/auth.types';
import { asOpaque } from '@/test-utils/type-assertions';
import { AuthController } from './auth';
import { resetAuthFinalizationLockForTests } from './auth-finalization-lock';

export function grantSession(pubky = 'alice', clientId = SHOP_GRANT_CLIENT_ID, grantId = 'grant-1'): Session {
  const publicKey = { z32: () => pubky };
  return asOpaque<Session>({
    info: { publicKey, capabilities: ['/:rw'] },
    grant: {
      grantId: vi.fn().mockResolvedValue(grantId),
      sessionInfo: vi.fn().mockResolvedValue({ publicKey, capabilities: ['/:rw'], clientId, grantId }),
    },
    signout: vi.fn().mockResolvedValue(undefined),
  });
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function resetGrantTest() {
  vi.restoreAllMocks();
  AuthController.setHostSessionMode(false);
  AuthController.cancelAllAuthFlows();
  AuthController.resetCleanupLocalStateGuard();
  resetAuthFinalizationLockForTests();
  localStorage.clear();
  clearPersistedAuthIdentity();
  useAuthStore.setState({ ...authInitialState, hasHydrated: true });
  vi.spyOn(AuthApplication, 'assertUserHomeserverAllowed').mockResolvedValue(undefined);
  vi.spyOn(AuthApplication, 'saveGrantSession').mockResolvedValue('alice:grant-1');
  vi.spyOn(AuthApplication, 'commitGrantSession').mockImplementation(() => {});
  vi.spyOn(AuthApplication, 'clearGrantSessions').mockResolvedValue(undefined);
  vi.spyOn(AuthApplication, 'removeGrantSession').mockResolvedValue(undefined);
  vi.spyOn(AuthApplication, 'logout').mockResolvedValue(undefined);
  vi.spyOn(AuthApplication, 'userIsSignedUp').mockResolvedValue(false);
  vi.spyOn(BootstrapApplication, 'cancelModerationFollow').mockImplementation(() => {});
  vi.spyOn(SettingsApplication, 'initializeSettings').mockResolvedValue(null);
  vi.spyOn(NotificationNormalizer, 'to').mockReturnValue(
    asOpaque({ meta: { url: 'pubky://alice/pub/pubky.app/last_read' } }),
  );
  vi.spyOn(BootstrapApplication, 'initialize').mockResolvedValue(asOpaque({}));
}

export async function approve(session: Session, signer: 'ring' | 'bitkit' | 'passport' = 'ring') {
  vi.spyOn(AuthApplication, 'generateGrantAuthUrl').mockResolvedValue({
    authorizationUrl: 'pubkyauth://signin_grant',
    awaitApproval: Promise.resolve(session),
    cancelAuthFlow: vi.fn(),
  });
  const flow =
    signer === 'ring'
      ? await AuthController.getAuthUrl()
      : signer === 'bitkit'
        ? await AuthController.getGrantAuthUrl()
        : await AuthController.getPassportGrantAuthUrl();
  return flow.awaitApproval;
}
