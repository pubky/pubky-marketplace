import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatApplication } from '@/application/chat/chat';
import { Logger } from '@/libs/logger/logger';
import { HomeserverService } from '@/services/homeserver/homeserver';
import { InboxService } from '@/services/inbox/inbox';
import { LocalChatService } from '@/services/local/chat/chat';
import { installFakeHomeserver } from '@/test-utils/fake-homeserver';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';

const ALICE = 'a'.repeat(52);
const BOB = 'b'.repeat(52);
const INBOX = 'https://inbox.test';

vi.mock('@/libs/runtime-config/runtime-config', async () => {
  const actual = await vi.importActual<typeof import('@/libs/runtime-config/runtime-config')>(
    '@/libs/runtime-config/runtime-config',
  );
  return { ...actual, getInboxUrl: () => 'https://inbox.test', getInboxAudience: () => 'https://inbox.test' };
});

/**
 * The prod Shop publishes an `inboxUrl` before the inbox is deployed there. Chat must keep working on homeserver
 * files, raise no error event per attempt, and start pinging by itself once the inbox answers.
 */
describe('ChatApplication with an inbox that is not up yet', () => {
  let inboxUp: boolean;
  let inboxRequests: string[];

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    installWebLocks();
    installFakeHomeserver();
    vi.spyOn(HomeserverService, 'canCurrentSessionWrite').mockReturnValue(true);
    vi.spyOn(HomeserverService, 'createInboxCredentials').mockResolvedValue({ grant: 'GRANT', pop: 'POP' });
    inboxUp = false;
    inboxRequests = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      inboxRequests.push(`${init.method} ${url}`);
      if (!inboxUp) throw new TypeError('Failed to fetch');
      if (url.endsWith('/v1/auth/session')) {
        const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
        return new Response(JSON.stringify({ access_token: 'TOKEN', expires_at: expiresAt }), { status: 201 });
      }
      return new Response(null, { status: 204 });
    });
    InboxService.clearSession();
    await LocalChatService.clearAll();
  });

  afterEach(async () => {
    InboxService.clearSession();
    await LocalChatService.clearAll();
    removeWebLocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends, is found on thread open, makes no error noise, and pings once the inbox answers', async () => {
    const error = vi.spyOn(Logger, 'error');
    const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);

    await ChatApplication.ensureIdentity(ALICE);
    await ChatApplication.ensureIdentity(BOB);
    await ChatApplication.openConversation(ALICE, BOB);
    const id = await ChatApplication.queueMessage(ALICE, { peer: BOB, body: 'Is this still available?' });
    await ChatApplication.flushOutbox(ALICE);
    expect((await LocalChatService.getMessage(id))?.status).toBe('sent');

    // Every later flush (reconcile passes, focus, online) is answered without touching the dead inbox.
    for (let pass = 0; pass < 20; pass += 1) {
      vi.setSystemTime(Date.now() + 1_000);
      await ChatApplication.flushOutbox(ALICE);
    }
    expect(inboxRequests.length).toBeLessThanOrEqual(3);

    // The recipient finds the message by opening the thread, with no ping.
    expect((await ChatApplication.openConversation(BOB, ALICE)).state).toBe('ready');
    await ChatApplication.syncConversation(BOB, ALICE, { reason: 'open' });
    const received = await LocalChatService.listMessages(BOB, ALICE, { limit: 10 });
    expect(received.map((row) => row.body)).toEqual(['Is this still available?']);

    expect(error).not.toHaveBeenCalled();
    expect(warn.mock.calls.filter(([message]) => String(message).includes('inbox'))).toHaveLength(1);
    expect((await LocalChatService.getSyncState(ALICE, BOB))?.ping_file).toBeTruthy();

    // The inbox comes up: the owed ping goes out on the next flush after the schedule allows an attempt.
    inboxUp = true;
    vi.setSystemTime(Date.now() + 10 * 60_000);
    await ChatApplication.flushOutbox(ALICE);
    expect(inboxRequests.slice(-2)).toEqual([`POST ${INBOX}/v1/auth/session`, `POST ${INBOX}/v1/pings`]);
    expect(error).not.toHaveBeenCalled();
  });
});
