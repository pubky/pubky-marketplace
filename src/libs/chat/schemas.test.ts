import { describe, expect, it } from 'vitest';
import {
  chatPingPayloadSchema,
  chatPlaintextSchema,
  chatPrivConversationSchema,
  chatPublicKeySchema,
  isChatPing,
} from './schemas';

const A = 'a'.repeat(52);
const B = 'b'.repeat(52);

describe('chat schemas', () => {
  it('accepts a public key record and rejects extra fields', () => {
    const record = { v: 0, alg: 'x25519', kid: 'f'.repeat(16), pk: 'AAAA', created_at: 1 };
    expect(chatPublicKeySchema.safeParse(record).success).toBe(true);
    expect(chatPublicKeySchema.safeParse({ ...record, sk: 'x' }).success).toBe(false);
  });

  it('caps the body by UTF-8 bytes', () => {
    const base = { v: 0, id: '018f47d2-6a27-7c23-a62f-000000000001', from: A, to: B, sent_at: 1 };
    expect(chatPlaintextSchema.safeParse({ ...base, body: 'é'.repeat(2048) }).success).toBe(true);
    expect(chatPlaintextSchema.safeParse({ ...base, body: 'é'.repeat(2049) }).success).toBe(false);
    expect(chatPlaintextSchema.safeParse({ ...base, body: '' }).success).toBe(false);
    expect(chatPlaintextSchema.safeParse({ ...base, body: 'x', context: { listingId: 'boots' } }).success).toBe(true);
  });

  it('validates private conversation records and ping payloads', () => {
    expect(
      chatPrivConversationSchema.safeParse({
        v: 0,
        peer: B,
        folder_id: '0'.repeat(32),
        peer_kid: 'f'.repeat(16),
        created_at: 1,
        last_read_at: 0,
        context: null,
      }).success,
    ).toBe(true);
    expect(
      chatPingPayloadSchema.safeParse({ v: 0, t: 'chat', folder: '0'.repeat(32), file: '1700000000000-deadbeef.json' })
        .success,
    ).toBe(true);
    expect(chatPingPayloadSchema.safeParse({ v: 0, t: 'chat', folder: 'short', file: 'x' }).success).toBe(false);
  });
});

describe('isChatPing', () => {
  const payload = JSON.stringify({ v: 0, t: 'chat', folder: 'f'.repeat(32), file: '1700000000000-aaaaaaaa.json' });

  it('accepts a chat slot with a well-formed payload', () => {
    expect(isChatPing({ slot: 'chat-' + 'f'.repeat(32), payload })).toBe(true);
  });

  it("refuses another app's slot and a payload that does not parse", () => {
    expect(isChatPing({ slot: 'app-' + 'f'.repeat(32), payload })).toBe(false);
    expect(isChatPing({ slot: 'chat-' + 'f'.repeat(32), payload: 'not json' })).toBe(false);
    expect(isChatPing({ slot: 'chat-' + 'f'.repeat(32), payload: JSON.stringify({ v: 0, t: 'other' }) })).toBe(false);
  });
});
