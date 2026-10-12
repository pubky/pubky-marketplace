import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatMessageUrl, chatPrivConversationUrl, chatPublicKeyUrl } from '@/libs/chat/paths';
import type { ChatEnvelope } from '@/libs/chat/schemas';
import { ChatHomeserverService } from '@/services/homeserver/chat/chat-storage';
import { type FakeHomeserver, installFakeHomeserver } from '@/test-utils/fake-homeserver';

const ME = 'm'.repeat(52);
const PEER = 'p'.repeat(52);
const FOLDER = '0123456789abcdef0123456789abcdef';
const KEY = { v: 0 as const, alg: 'x25519' as const, kid: 'a'.repeat(16), pk: 'AAAA', created_at: 1 };
const ENVELOPE: ChatEnvelope = {
  v: 0,
  enc: 'pubky-chat/xchacha20poly1305/v0',
  ks: 'a'.repeat(16),
  kr: 'b'.repeat(16),
  n: 'AA',
  ct: 'AA',
};

describe('ChatHomeserverService', () => {
  let homeserver: FakeHomeserver;

  beforeEach(() => {
    homeserver = installFakeHomeserver();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads public keys and treats malformed ones as absent', async () => {
    expect(await ChatHomeserverService.readPublicKey(PEER)).toBeNull();
    homeserver.files.set(chatPublicKeyUrl(PEER), KEY);
    expect(await ChatHomeserverService.readPublicKey(PEER)).toEqual(KEY);
    homeserver.files.set(chatPublicKeyUrl(PEER), { v: 1 });
    expect(await ChatHomeserverService.readPublicKey(PEER)).toBeNull();
  });

  it('writes the private key with a verified read-back and never logs its path', async () => {
    const record = { ...KEY, sk: 'BBBB' };
    await ChatHomeserverService.writePrivateKey(ME, record);
    expect(await ChatHomeserverService.readPrivateKey(ME)).toEqual(record);
    expect(homeserver.unredacted).toEqual([]);
    homeserver.corruptNextPut(/\/priv\/chat\/v0\/key\.json$/u, () => ({ ...record, sk: 'CCCC' }));
    await expect(ChatHomeserverService.writePrivateKey(ME, record)).rejects.toThrow(/did not store/u);
  });

  it('lists, filters and pages message files', async () => {
    const names = ['1700000000001-aaaaaaaa.json', '1700000000002-bbbbbbbb.json', '1700000000003-cccccccc.json'];
    for (const name of names) homeserver.files.set(chatMessageUrl(PEER, FOLDER, name), ENVELOPE);
    homeserver.files.set(chatMessageUrl(PEER, FOLDER, '0000000000000-stray.txt'), 'nope');
    expect(await ChatHomeserverService.listMessageFiles(PEER, FOLDER)).toEqual(names);
    expect(
      await ChatHomeserverService.listMessageFiles(PEER, FOLDER, { cursor: chatMessageUrl(PEER, FOLDER, names[0]) }),
    ).toEqual(names.slice(1));
    expect(await ChatHomeserverService.listMessageFiles(PEER, FOLDER, { reverse: true, limit: 1 })).toEqual([names[2]]);
    expect(await ChatHomeserverService.listMessageFiles(PEER, 'f'.repeat(32))).toEqual([]);
  });

  it('reads message files and skips missing or oversize ones', async () => {
    const name = '1700000000001-aaaaaaaa.json';
    homeserver.files.set(chatMessageUrl(PEER, FOLDER, name), ENVELOPE);
    expect(await ChatHomeserverService.readMessageFile(PEER, FOLDER, name)).toEqual(ENVELOPE);
    expect(await ChatHomeserverService.readMessageFile(PEER, FOLDER, '1700000000009-dddddddd.json')).toBeNull();
    homeserver.files.set(chatMessageUrl(PEER, FOLDER, name), { ...ENVELOPE, ct: 'x'.repeat(9_000) });
    expect(await ChatHomeserverService.readMessageFile(PEER, FOLDER, name)).toBeNull();
  });

  it('round-trips and lists private conversation records', async () => {
    const record = {
      v: 0 as const,
      peer: PEER,
      folder_id: FOLDER,
      peer_kid: 'a'.repeat(16),
      created_at: 1,
      last_read_at: 0,
      context: null,
    };
    await ChatHomeserverService.writeConversationState(ME, record);
    homeserver.files.set(chatPrivConversationUrl(ME, 'z'.repeat(52)), { v: 9 });
    expect(await ChatHomeserverService.readConversationState(ME, PEER)).toEqual(record);
    expect(await ChatHomeserverService.listConversationStates(ME)).toEqual([record]);
    expect(homeserver.unredacted).toEqual([]);
  });
});
