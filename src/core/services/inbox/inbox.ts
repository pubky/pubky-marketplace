import { z } from 'zod';
import { CHAT_PING_MAX_BYTES } from '@/config/chat';
import { utf8Bytes } from '@/libs/chat/encoding';
import { isAppError } from '@/libs/error/error';
import { ServerErrorCode, ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { httpResponseToError, safeFetch } from '@/libs/error/error.http';
import { ErrorService } from '@/libs/error/error.types';
import { Logger } from '@/libs/logger/logger';
import { getInboxAudience, getInboxUrl } from '@/libs/runtime-config/runtime-config';
import { shopStorageKey } from '@/libs/storage-namespace/storage-namespace';
import type {
  InboxAvailability,
  InboxCredentialsProvider,
  InboxPing,
  InboxPingRef,
  InboxSendParams,
  InboxSessionInfo,
  InboxWaitParams,
} from './inbox.types';

/** `localStorage` key of the inbox bearer: shared by every tab so one account holds one session. */
export const INBOX_SESSION_STORAGE_KEY = shopStorageKey('chat-inbox-session:v1');
/** Drop a session this close to its expiry instead of using it. */
const SESSION_EXPIRY_MARGIN_MS = 60_000;

const sessionResponseSchema = z.object({ access_token: z.string().min(1), expires_at: z.string().min(1) });
const pingsResponseSchema = z.object({
  pings: z.array(
    z.object({
      sender: z.string().min(1),
      slot: z.string().min(1),
      revision: z.string().min(1),
      received_at: z.string(),
      expires_at: z.string(),
      payload: z.string(),
    }),
  ),
});
const storedSessionSchema = z.object({
  pubky: z.string().min(1),
  token: z.string().min(1),
  expiresAt: z.string().min(1),
});

/**
 * Client of the `pubky/inbox` ping service. A ping is a tiny wake-up for the
 * recipient, never the message itself. Sessions come from a grant proof the
 * caller supplies; the bearer is kept in memory and mirrored to
 * `localStorage` (the marketplace bearer's posture) so tabs share it.
 */
export class InboxService {
  private constructor() {}

  private static session: InboxSessionInfo | null = null;

  static isConfigured(): boolean {
    return getInboxUrl() !== null;
  }

  /** Establishes (or reuses) the inbox session for `me`. */
  static async ensureSession(me: string, getCredentials: InboxCredentialsProvider): Promise<InboxAvailability> {
    const baseUrl = getInboxUrl();
    const audience = getInboxAudience();
    if (!baseUrl || !audience) return 'disabled';
    if (this.readSession(me)) return 'ready';

    const credentials = await getCredentials({ type: 'pubky-inbox-session-v1', audience });
    if (!credentials) return 'needs_grant';

    const url = `${baseUrl}/v1/auth/session`;
    const response = await safeFetch(
      url,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) },
      ErrorService.Inbox,
      'ensureSession',
    );
    if (!response.ok) throw httpResponseToError(response, ErrorService.Inbox, 'ensureSession', url);
    const parsed = sessionResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'The inbox returned an invalid session.', {
        service: ErrorService.Inbox,
        operation: 'ensureSession',
        context: { url },
      });
    }
    this.writeSession({ pubky: me, token: parsed.data.access_token, expiresAt: parsed.data.expires_at });
    Logger.info('Established inbox session', { expiresAt: parsed.data.expires_at });
    return 'ready';
  }

  /** Sends a ping; the service replaces any pending ping in the same slot for this pair. */
  static async ping(me: string, params: InboxSendParams): Promise<void> {
    const bytes = utf8Bytes(params.payload);
    if (bytes < 1 || bytes > CHAT_PING_MAX_BYTES) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, `An inbox ping must be 1–${CHAT_PING_MAX_BYTES} bytes.`, {
        service: ErrorService.Inbox,
        operation: 'ping',
        context: { bytes },
      });
    }
    await this.authorized(me, 'ping', '/v1/pings', {
      method: 'POST',
      body: JSON.stringify({
        slot: params.slot,
        recipient: params.recipient,
        payload: params.payload,
        ttl_seconds: params.ttlSeconds,
      }),
    });
  }

  /** Long-polls for pending pings, oldest first. */
  static async waitForPings(me: string, params: InboxWaitParams): Promise<InboxPing[]> {
    const query = `?limit=${params.limit}&wait=${params.waitSeconds}`;
    const response = await this.authorized(me, 'waitForPings', `/v1/pings${query}`, {
      method: 'GET',
      signal: params.signal,
    });
    const parsed = pingsResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw Err.server(ServerErrorCode.INVALID_RESPONSE, 'The inbox returned an invalid ping list.', {
        service: ErrorService.Inbox,
        operation: 'waitForPings',
      });
    }
    return parsed.data.pings;
  }

  /** Deletes the pings for every device of this account. */
  static async ack(me: string, pings: InboxPingRef[]): Promise<void> {
    if (pings.length === 0) return;
    await this.authorized(me, 'ack', '/v1/pings/ack', {
      method: 'POST',
      body: JSON.stringify({ pings: pings.map(({ sender, slot, revision }) => ({ sender, slot, revision })) }),
    });
  }

  /** Ends the inbox session server-side (best effort) and forgets it locally. */
  static async endSession(me: string): Promise<void> {
    const session = this.readSession(me);
    this.clearSession();
    const baseUrl = getInboxUrl();
    if (!session || !baseUrl) return;
    try {
      await safeFetch(
        `${baseUrl}/v1/auth/session`,
        { method: 'DELETE', headers: { authorization: `Bearer ${session.token}` } },
        ErrorService.Inbox,
        'endSession',
      );
    } catch (error) {
      Logger.warn('Could not end the inbox session; it expires on its own', { error });
    }
  }

  static clearSession(): void {
    this.session = null;
    this.removeStored();
  }

  /** A sign-in replacing another account must not keep that account's bearer at rest. */
  static clearSessionsOfOtherAccounts(keepPubky: string): void {
    const stored = this.readStored();
    if (stored && stored.pubky !== keepPubky) this.removeStored();
    if (this.session && this.session.pubky !== keepPubky) this.session = null;
  }

  // ---------------------------------------------------------------- internals

  private static async authorized(
    me: string,
    operation: string,
    path: string,
    init: { method: string; body?: string; signal?: AbortSignal },
    retried = false,
  ): Promise<Response> {
    const baseUrl = getInboxUrl();
    const session = this.readSession(me);
    if (!baseUrl || !session) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'No inbox session.', {
        service: ErrorService.Inbox,
        operation,
      });
    }
    const url = `${baseUrl}${path}`;
    const response = await safeFetch(
      url,
      {
        method: init.method,
        headers: {
          authorization: `Bearer ${session.token}`,
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: init.body,
        signal: init.signal,
      },
      ErrorService.Inbox,
      operation,
    );
    if (response.status === 401 && !retried) {
      // The service ended the session (expiry, eviction); the next ensureSession re-establishes it.
      this.clearSession();
      throw httpResponseToError(response, ErrorService.Inbox, operation, url);
    }
    if (!response.ok) throw httpResponseToError(response, ErrorService.Inbox, operation, url);
    return response;
  }

  private static readSession(me: string): InboxSessionInfo | null {
    const candidate = this.session ?? this.readStored();
    if (!candidate || candidate.pubky !== me) return null;
    if (Date.parse(candidate.expiresAt) - SESSION_EXPIRY_MARGIN_MS <= Date.now()) {
      this.clearSession();
      return null;
    }
    this.session = candidate;
    return candidate;
  }

  private static writeSession(session: InboxSessionInfo): void {
    this.session = session;
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(INBOX_SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Storage unavailable: the in-memory session still serves this tab.
    }
  }

  private static readStored(): InboxSessionInfo | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(INBOX_SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = storedSessionSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private static removeStored(): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(INBOX_SESSION_STORAGE_KEY);
    } catch {
      // Nothing persisted, nothing to remove.
    }
  }
}

/** Whether an inbox failure means the session is gone (re-establish on the next pass). */
export function isInboxSessionGone(error: unknown): boolean {
  return isAppError(error) && error.context?.statusCode === 401;
}
