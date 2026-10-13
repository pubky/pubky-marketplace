export type { TRestorePersistedSessionResult } from '@/application/auth/auth.types';

export interface TSignUpParams {
  secretKey: string;
  signupToken: string;
}

export interface TLoginWithMnemonicParams {
  mnemonic: string;
}

export interface TLoginWithEncryptedFileParams {
  encryptedFile: File;
  password: string;
}

/** Public App reference; no tokens or key material crosses the bridge. */
export type HostSessionSnapshot = {
  generation: string;
  shopCleanupEpoch?: string;
  status: 'ready' | 'signed-out' | 'restoring' | 'temporary-error' | 'reauth-required';
  pubky: string | null;
  sessionStoreId: string | null;
  grantId: string | null;
  clientId: string | null;
};

export type HostSessionApplyStatus = HostSessionSnapshot['status'] | 'capabilities-required';
