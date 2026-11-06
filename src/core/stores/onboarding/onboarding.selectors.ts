import { ZustandGet } from '../stores.types';
import { OnboardingStore } from './onboarding.types';

export const createOnboardingSelectors = (get: ZustandGet<OnboardingStore>) => ({
  /**
   * Gets the secret key (private key) from the keypair
   * @returns The secret key as a hex string
   * @throws Error if keypair is not available
   */
  selectSecretKey: () => {
    const secretKey = get().secretKey;
    if (!secretKey) {
      // TODO: Specific error type
      throw new Error('Secret key is not available. Please generate first.');
    }
    return secretKey;
  },
});
