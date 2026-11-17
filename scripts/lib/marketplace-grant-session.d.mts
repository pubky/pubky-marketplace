import type { Keypair, Pubky, Session } from '@synonymdev/pubky';

export type MintedGrantSession = {
  token: string;
  sessionId: string;
  pubky: string;
  capabilities: string;
  expiresAt: string;
};

export function mintMarketplaceGrantSession(options: {
  session: Session;
  expectedPubky: string;
  serviceUrl: string;
  acceptedCapabilities?: readonly string[];
}): Promise<MintedGrantSession>;

export function mintMarketplaceGrantSessionForSigner(options: {
  client: Pubky;
  keypair: Keypair;
  clientId: string;
  serviceUrl: string;
  acceptedCapabilities?: readonly string[];
}): Promise<MintedGrantSession>;
