/** `POST /v1/auth/session` proof data: the inbox compares it byte for byte. */
export type InboxSessionProofData = { type: 'pubky-inbox-session-v1'; audience: string };

export type InboxCredentials = { grant: string; pop: string };

/**
 * Produces the grant + proof for an inbox session, or `null` when the
 * signed-in session cannot sign one (cookie session, older SDK).
 */
export type InboxCredentialsProvider = (data: InboxSessionProofData) => Promise<InboxCredentials | null>;

export type InboxAvailability = 'disabled' | 'needs_grant' | 'ready';

export type InboxPing = {
  /** Server-asserted sender pubky. */
  sender: string;
  slot: string;
  /** Opaque id of this delivery; acknowledged by value. */
  revision: string;
  received_at: string;
  expires_at: string;
  payload: string;
};

export type InboxPingRef = Pick<InboxPing, 'sender' | 'slot' | 'revision'>;

export type InboxSendParams = {
  slot: string;
  recipient: string;
  /** 1–512 UTF-8 bytes. */
  payload: string;
  ttlSeconds: number;
};

export type InboxWaitParams = {
  limit: number;
  /** 0–25 seconds of long-poll. */
  waitSeconds: number;
  signal?: AbortSignal;
};

export type InboxSessionInfo = {
  pubky: string;
  token: string;
  /** ISO 8601. */
  expiresAt: string;
};
