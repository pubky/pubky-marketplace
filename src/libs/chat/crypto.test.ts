import { describe, expect, it } from 'vitest';
import {
  chatAad,
  chatKeyId,
  decryptChatEnvelope,
  derivePairwise,
  derivePairwiseRoot,
  encryptChatEnvelope,
  generateChatKeypair,
} from './crypto';
import type { ChatPlaintext } from './schemas';

const A = 'a'.repeat(52);
const B = 'b'.repeat(52);
const C = 'c'.repeat(52);

const party = (pubky: string, keys: { publicKey: Uint8Array }) => ({ pubky, publicKey: keys.publicKey });

function plaintext(from: string, to: string, body = 'hello'): ChatPlaintext {
  return { v: 0, id: '018f47d2-6a27-7c23-a62f-000000000001', from, to, sent_at: 1_700_000_000_000, body };
}

describe('chat crypto', () => {
  it('derives the same message key and mirrored folders from either side', () => {
    const alice = generateChatKeypair();
    const bob = generateChatKeypair();
    const fromAlice = derivePairwise(alice.secretKey, party(A, alice), party(B, bob));
    const fromBob = derivePairwise(bob.secretKey, party(B, bob), party(A, alice));
    expect(fromAlice.messageKey).toEqual(fromBob.messageKey);
    // Alice writes into the folder Bob reads, and the other way round.
    expect(fromAlice.ownFolderId).toBe(fromBob.peerFolderId);
    expect(fromAlice.peerFolderId).toBe(fromBob.ownFolderId);
    expect(fromAlice.ownFolderId).toMatch(/^[0-9a-f]{32}$/u);
    // The two folders differ, so listing both homeservers links nothing.
    expect(fromAlice.ownFolderId).not.toBe(fromAlice.peerFolderId);
  });

  it('gives different pairs different folders', () => {
    const alice = generateChatKeypair();
    const bob = generateChatKeypair();
    const carol = generateChatKeypair();
    const ab = derivePairwise(alice.secretKey, party(A, alice), party(B, bob));
    const ac = derivePairwise(alice.secretKey, party(A, alice), party(C, carol));
    expect(ab.ownFolderId).not.toBe(ac.ownFolderId);
    expect(ab.peerFolderId).not.toBe(ac.peerFolderId);
  });

  it('binds the accounts: a copied public key under another pubky derives different folders and key', () => {
    const alice = generateChatKeypair();
    const bob = generateChatKeypair();
    const withAlice = derivePairwise(bob.secretKey, party(B, bob), party(A, alice));
    const withMallory = derivePairwise(bob.secretKey, party(B, bob), party(C, alice));
    expect(withMallory.messageKey).not.toEqual(withAlice.messageKey);
    expect(withMallory.ownFolderId).not.toBe(withAlice.ownFolderId);
    expect(withMallory.peerFolderId).not.toBe(withAlice.peerFolderId);
  });

  it('rejects a low-order peer key and a peer key equal to my own', () => {
    const alice = generateChatKeypair();
    expect(() =>
      derivePairwiseRoot(alice.secretKey, party(A, alice), party(B, { publicKey: new Uint8Array(32) })),
    ).toThrow();
    expect(() => derivePairwiseRoot(alice.secretKey, party(A, alice), party(B, alice))).toThrow(/equals own key/u);
  });

  it('round-trips a message and binds it to its path', () => {
    const alice = generateChatKeypair();
    const bob = generateChatKeypair();
    const { messageKey } = derivePairwise(alice.secretKey, party(A, alice), party(B, bob));
    const senderKid = chatKeyId(alice.publicKey);
    const recipientKid = chatKeyId(bob.publicKey);
    const path = '/pub/chat/v0/0123456789abcdef0123456789abcdef/1700000000000-deadbeef.json';
    const envelope = encryptChatEnvelope({
      messageKey,
      senderKid,
      recipientKid,
      aad: chatAad(A, B, path),
      plaintext: plaintext(A, B),
    });
    expect(envelope.ks).toBe(senderKid);

    const opened = decryptChatEnvelope({
      messageKey,
      expectedSenderKid: senderKid,
      expectedRecipientKid: recipientKid,
      aad: chatAad(A, B, path),
      envelope,
    });
    expect(opened).toEqual({ ok: true, plaintext: plaintext(A, B) });

    const moved = decryptChatEnvelope({
      messageKey,
      expectedSenderKid: senderKid,
      expectedRecipientKid: recipientKid,
      aad: chatAad(A, B, path.replace('deadbeef', 'cafebabe')),
      envelope,
    });
    expect(moved).toEqual({ ok: false, reason: 'unauthenticated' });

    const tampered = decryptChatEnvelope({
      messageKey,
      expectedSenderKid: senderKid,
      expectedRecipientKid: recipientKid,
      aad: chatAad(A, B, path),
      envelope: { ...envelope, ct: envelope.ct.slice(0, -2) + 'AA' },
    });
    expect(tampered).toEqual({ ok: false, reason: 'unauthenticated' });
  });

  it('reports malformed files and foreign keys without throwing', () => {
    const alice = generateChatKeypair();
    const bob = generateChatKeypair();
    const { messageKey } = derivePairwise(alice.secretKey, party(A, alice), party(B, bob));
    const base = {
      messageKey,
      expectedSenderKid: chatKeyId(alice.publicKey),
      expectedRecipientKid: chatKeyId(bob.publicKey),
      aad: chatAad(A, B, '/pub/chat/v0/x/y'),
    };
    expect(decryptChatEnvelope({ ...base, envelope: 'nope' })).toEqual({ ok: false, reason: 'malformed' });
    expect(decryptChatEnvelope({ ...base, envelope: { v: 0 } })).toEqual({ ok: false, reason: 'malformed' });
    const envelope = encryptChatEnvelope({
      messageKey,
      senderKid: 'f'.repeat(16),
      recipientKid: base.expectedRecipientKid,
      aad: base.aad,
      plaintext: plaintext(A, B),
    });
    expect(decryptChatEnvelope({ ...base, envelope })).toEqual({ ok: false, reason: 'unknown_key' });
  });

  it('rejects an invalid plaintext even when it authenticates', () => {
    const alice = generateChatKeypair();
    const bob = generateChatKeypair();
    const { messageKey } = derivePairwise(alice.secretKey, party(A, alice), party(B, bob));
    const kids = { senderKid: chatKeyId(alice.publicKey), recipientKid: chatKeyId(bob.publicKey) };
    const aad = chatAad(A, B, '/pub/chat/v0/x/y');
    const envelope = encryptChatEnvelope({
      messageKey,
      ...kids,
      aad,
      plaintext: { ...plaintext(A, B), body: '' } as ChatPlaintext,
    });
    expect(
      decryptChatEnvelope({
        messageKey,
        expectedSenderKid: kids.senderKid,
        expectedRecipientKid: kids.recipientKid,
        aad,
        envelope,
      }),
    ).toEqual({ ok: false, reason: 'invalid_plaintext' });
  });

  it('key ids are 16 hex characters derived from the public key', () => {
    const { publicKey } = generateChatKeypair();
    expect(chatKeyId(publicKey)).toMatch(/^[0-9a-f]{16}$/u);
    expect(chatKeyId(publicKey)).toBe(chatKeyId(publicKey));
  });
});
