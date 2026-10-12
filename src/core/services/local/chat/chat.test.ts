import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatConversationModelSchema, ChatMessageModelSchema } from '@/models/chat/chat.schema';
import { chatPreview, LocalChatService } from '@/services/local/chat/chat';

const OWNER = 'o'.repeat(52);
const PEER = 'p'.repeat(52);
const OTHER = 'q'.repeat(52);

function conversation(peer: string, extra: Partial<ChatConversationModelSchema> = {}): ChatConversationModelSchema {
  return {
    id: `${OWNER}:${peer}`,
    owner_id: OWNER,
    peer_pubky: peer,
    folder_id: '0'.repeat(32),
    peer_key_id: 'a'.repeat(16),
    my_key_id: 'b'.repeat(16),
    peer_state: 'ready',
    origin: 'local',
    last_message_at: null,
    last_message_preview: null,
    last_message_direction: null,
    last_read_at: 0,
    last_context: null,
    priv_state_dirty: false,
    created_at: 1,
    updated_at: 1,
    ...extra,
  };
}

function message(
  id: string,
  sentAt: number,
  direction: ChatMessageModelSchema['direction'],
  extra: Partial<ChatMessageModelSchema> = {},
): ChatMessageModelSchema {
  return {
    id: `${OWNER}:${id}`,
    owner_id: OWNER,
    peer_pubky: PEER,
    direction,
    file_name: `${String(sentAt).padStart(13, '0')}-${id.padEnd(8, '0').slice(0, 8)}.json`,
    sent_at: sentAt,
    received_at: sentAt,
    body: `body ${id}`,
    context: null,
    status: 'sent',
    attempts: 0,
    next_attempt_at: null,
    last_error: null,
    clock_skewed: false,
    ...extra,
  };
}

describe('LocalChatService', () => {
  beforeEach(async () => {
    await LocalChatService.clearAll();
  });

  afterEach(async () => {
    await LocalChatService.clearAll();
  });

  it('orders conversations by latest activity and keeps empty ones last', async () => {
    await LocalChatService.upsertConversation(conversation(PEER, { last_message_at: 10 }));
    await LocalChatService.upsertConversation(conversation(OTHER));
    await LocalChatService.upsertConversation(conversation('r'.repeat(52), { last_message_at: 20 }));
    const rows = await LocalChatService.listConversations(OWNER);
    expect(rows.map((row) => row.peer_pubky)).toEqual(['r'.repeat(52), PEER, OTHER]);
  });

  it('adds messages once and reports which were new', async () => {
    await LocalChatService.upsertConversation(conversation(PEER));
    const first = await LocalChatService.addMessages([message('aaaa', 1_000, 'received')]);
    const second = await LocalChatService.addMessages([
      message('aaaa', 1_000, 'received'),
      message('bbbb', 2_000, 'sent'),
    ]);
    expect(first).toEqual([`${OWNER}:aaaa`]);
    expect(second).toEqual([`${OWNER}:bbbb`]);
    expect(await LocalChatService.countMessages(OWNER, PEER)).toBe(2);
  });

  it('pages a thread newest-first by file name and returns it oldest-first', async () => {
    await LocalChatService.addMessages([1, 2, 3, 4, 5].map((n) => message(`m${n}`, n * 1_000, 'received')));
    const page = await LocalChatService.listMessages(OWNER, PEER, { limit: 2 });
    expect(page.map((row) => row.sent_at)).toEqual([4_000, 5_000]);
    const older = await LocalChatService.listMessages(OWNER, PEER, { limit: 2, before: page[0].file_name });
    expect(older.map((row) => row.sent_at)).toEqual([2_000, 3_000]);
  });

  it('counts unread received messages after the read checkpoint', async () => {
    await LocalChatService.upsertConversation(conversation(PEER, { last_read_at: 1_500 }));
    await LocalChatService.addMessages([
      message('r1', 1_000, 'received'),
      message('r2', 2_000, 'received'),
      message('s1', 3_000, 'sent'),
    ]);
    expect(await LocalChatService.countUnread(OWNER, PEER, 1_500)).toBe(1);
    expect(await LocalChatService.countUnreadConversations(OWNER)).toBe(1);
    expect(await LocalChatService.markRead(OWNER, PEER, 2_500)).toBe(true);
    expect(await LocalChatService.markRead(OWNER, PEER, 2_000)).toBe(false);
    const row = await LocalChatService.getConversation(OWNER, PEER);
    expect(row?.last_read_at).toBe(2_500);
    expect(row?.priv_state_dirty).toBe(true);
    expect(await LocalChatService.countUnreadConversations(OWNER)).toBe(0);
  });

  it('touches the conversation monotonically', async () => {
    await LocalChatService.upsertConversation(conversation(PEER));
    await LocalChatService.touchConversation(OWNER, PEER, {
      sentAt: 5_000,
      body: 'newer',
      direction: 'received',
      context: null,
    });
    await LocalChatService.touchConversation(OWNER, PEER, {
      sentAt: 4_000,
      body: 'older',
      direction: 'sent',
      context: null,
    });
    const row = await LocalChatService.getConversation(OWNER, PEER);
    expect(row?.last_message_at).toBe(5_000);
    expect(row?.last_message_preview).toBe('newer');
    expect(row?.last_message_direction).toBe('received');
  });

  it('lists the due outbox in file order', async () => {
    await LocalChatService.addMessages([
      message('q2', 2_000, 'sent', { status: 'queued', next_attempt_at: null }),
      message('q1', 1_000, 'sent', { status: 'queued', next_attempt_at: 10 }),
      message('q3', 3_000, 'sent', { status: 'queued', next_attempt_at: 99_999 }),
      message('f1', 4_000, 'sent', { status: 'failed' }),
    ]);
    const due = await LocalChatService.listDueOutbox(OWNER, 100);
    expect(due.map((row) => row.sent_at)).toEqual([1_000, 2_000]);
  });

  it('upserts sync state on update when missing', async () => {
    await LocalChatService.updateSyncState(OWNER, PEER, { list_cursor: 'cursor-1' });
    expect((await LocalChatService.getSyncState(OWNER, PEER))?.list_cursor).toBe('cursor-1');
    await LocalChatService.updateSyncState(OWNER, PEER, { consecutive_failures: 2 });
    const state = await LocalChatService.getSyncState(OWNER, PEER);
    expect(state?.list_cursor).toBe('cursor-1');
    expect(state?.consecutive_failures).toBe(2);
  });

  it('previews bodies on one line', () => {
    expect(chatPreview('  hello\n\nworld  ')).toBe('hello world');
    expect(chatPreview('x'.repeat(200))).toHaveLength(120);
  });
});
