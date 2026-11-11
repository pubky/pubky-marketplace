import { validateMnemonic } from 'bip39';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import type { ZustandGet } from '../stores.types';
import type { OnboardingSelectors, OnboardingStore } from './onboarding.types';

const isSecretKey = (secretKey: string | null): secretKey is string =>
  typeof secretKey === 'string' && /^[0-9a-f]{64}$/i.test(secretKey);

export const createOnboardingSelectors = (get: ZustandGet<OnboardingStore>): OnboardingSelectors => ({
  selectHasSecretKey: () => isSecretKey(get().secretKey),
  selectHasMnemonic: () => {
    const mnemonic = get().mnemonic;
    return typeof mnemonic === 'string' && validateMnemonic(mnemonic);
  },
  /** Return a saved legacy key only for the explicitly requested recovery export. */
  selectSecretKey: () => {
    const secretKey = get().secretKey;
    if (!isSecretKey(secretKey)) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'A saved recovery key is unavailable on this device.', {
        service: ErrorService.Local,
        operation: 'selectSecretKey',
      });
    }
    return secretKey;
  },
});
