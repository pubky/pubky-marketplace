import { CommerceAttestorApplication } from '@/application/commerce/attestor';
import { configuredMarketplaceTrustedAttestors, marketplaceTrustedAttestors } from '@/config/commerce';

/** Effective trust and profile read results for the public agent guide. */
export class CommerceAttestorGuideController {
  private constructor() {}

  static async getTrustSnapshot() {
    await CommerceAttestorApplication.loadKeyWindows();
    return {
      trustedAttestors: marketplaceTrustedAttestors(),
      configured: configuredMarketplaceTrustedAttestors(),
      unconfirmedAttestorIds: CommerceAttestorApplication.unconfirmedProfileAttestors(),
      retainedCutoffAttestorIds: CommerceAttestorApplication.retainedCutoffProfileAttestors(),
    };
  }
}
