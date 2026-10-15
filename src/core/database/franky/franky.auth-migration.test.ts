import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/database/franky/franky';
import { clearDatabase, clearPrivateData } from '@/database/franky/franky.helpers';
import {
  dropCachedWrappingKeyForTests,
  getOrCreateWrappingKey,
  resetMessagingKeyringForTests,
} from '@/libs/crypto/messaging-keyring';

describe('same-identity auth migration history retention', () => {
  beforeEach(async () => {
    await resetMessagingKeyringForTests();
  });

  it.each([clearPrivateData, clearDatabase])(
    'keeps wrapped history decryptable during an auth migration',
    async (clear) => {
      const originalKey = await getOrCreateWrappingKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, originalKey, new Uint8Array([1, 2, 3]));
      await db.table('commerce_messaging_messages').put({ id: 'history', body: ciphertext });
      await db.table('commerce_messaging_conversations').put({ id: 'conversation' });
      await clear({ preserveMessagingHistory: true });
      expect(await db.table('commerce_messaging_messages').get('history')).toBeDefined();
      expect(await db.table('commerce_messaging_conversations').get('conversation')).toBeDefined();
      dropCachedWrappingKeyForTests();
      const restoredKey = await getOrCreateWrappingKey();
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, restoredKey, ciphertext);
      expect([...new Uint8Array(plaintext)]).toEqual([1, 2, 3]);
    },
  );

  it('still removes private history and rotates the key on normal logout', async () => {
    const originalKey = await getOrCreateWrappingKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, originalKey, new Uint8Array([1]));
    await db.table('commerce_messaging_messages').put({ id: 'history' });
    await clearPrivateData();
    expect(await db.table('commerce_messaging_messages').get('history')).toBeUndefined();
    dropCachedWrappingKeyForTests();
    const restoredKey = await getOrCreateWrappingKey();
    await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv }, restoredKey, ciphertext)).rejects.toThrow();
  });
});
