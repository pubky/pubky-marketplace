import type {
  MarketplaceApprovalSigner,
  MarketplaceSignerChoice,
} from '@/hooks/useMarketplaceApprovalSigner/useMarketplaceApprovalSigner';
import type { CommerceMarketplaceSession } from '@/stores/commerce/commerce.types';

/** One scoped marketplace service approval; each retry creates a fresh flow. */
export type MarketplaceSessionConnectStatus =
  | 'idle'
  | 'creating'
  | 'awaiting'
  | 'verifying'
  | 'claiming'
  | 'joined'
  | 'connected'
  | 'mismatch'
  | 'expired'
  | 'cancelled'
  | 'error';

export interface UseMarketplaceSessionConnectOptions {
  /** Explicit approval signer for imported-key and host-owned sessions. */
  signer?: MarketplaceSignerChoice | null;
  /** Called once per successful connect, after the store has been updated. */
  onConnected?: (session: CommerceMarketplaceSession) => void;
}

export interface UseMarketplaceSessionConnectReturn {
  status: MarketplaceSessionConnectStatus;
  /** The `pubkyauth://` URL to render as a QR or open as a Ring deeplink. Empty outside `awaiting`. */
  authorizationUrl: string;
  /** The real failure message when `status === 'error'`, never a placeholder. */
  errorMessage: string | null;
  /** Always false: browser sign-in and service approval are separate grants. */
  requestsFullGrant: boolean;
  /** Reconnects an existing marketplace bearer through the Shop BFF. */
  requestsGrantReconnect: boolean;
  /**
   * True while `start()` is running (or about to run) the browser bootstrap:
   * a signed-in Shop session with no marketplace bearer yet.
   * Uses a grant link that Pubky Ring 2.0+ or Bitkit can approve; Passport uses its popup.
   */
  requestsGrantBootstrap: boolean;
  /**
   * True when Pubky Passport approved the Shop sign-in, so it approves this
   * grant too. Passport opens in a popup, which needs a click: `start()` only
   * arms the approval (status `idle`, no URL) and `startPassport()` runs it.
   * The URL is set while Passport shows it, for the disclosure only: it is
   * never a QR or a deeplink.
   */
  requestsPassport: boolean;
  /** The recorded or explicitly selected signer for this service approval. */
  approvalSigner: MarketplaceApprovalSigner;
  requiresSignerChoice: boolean;
  /** A remembered identity alone cannot authorize the bootstrap proof. */
  requiresSignIn: boolean;
  /** Begins a fresh flow, cancelling any in-flight one. */
  start: () => void;
  /** Opens the armed Passport approval. Call it from the click handler itself. */
  startPassport: () => void;
  /** Cancels the in-flight flow (frees it) and returns to `idle`. */
  cancel: () => void;
  /** Copies the authorization URL for manual transfer to the signer device. */
  copyAuthUrl: () => Promise<void>;
  /** Opens the authorization URL as a deeplink (same-device Pubky Ring). */
  openInRing: () => void;
  /** True between tapping "Open in Pubky Ring" and the page losing focus to the Ring app. */
  isOpeningRing: boolean;
}
