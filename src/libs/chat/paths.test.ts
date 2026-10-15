import { describe, expect, it } from 'vitest';
import {
  chatFolderPath,
  chatMessageUrl,
  chatPrivConversationUrl,
  chatPublicKeyUrl,
  fileNameFromUrl,
  mintChatFileName,
  parseChatEventPath,
  parseChatFileName,
  peerFromConversationUrl,
} from './paths';

const ME = 'm'.repeat(52);
const PEER = 'p'.repeat(52);
const FOLDER = '0123456789abcdef0123456789abcdef';

describe('chat paths', () => {
  it('builds the v0 layout', () => {
    expect(chatPublicKeyUrl(ME)).toBe(`pubky://${ME}/pub/chat/v0/key.json`);
    expect(chatPrivConversationUrl(ME, PEER)).toBe(`pubky://${ME}/priv/chat/v0/conversations/${PEER}.json`);
    expect(chatMessageUrl(ME, FOLDER, '1700000000000-deadbeef.json')).toBe(
      `pubky://${ME}/pub/chat/v0/${FOLDER}/1700000000000-deadbeef.json`,
    );
    expect(chatFolderPath(FOLDER)).toBe(`/pub/chat/v0/${FOLDER}/`);
  });

  it('mints chronological file names and parses them back', () => {
    const name = mintChatFileName(1_700_000_000_000, 'deadbeef');
    expect(name).toBe('1700000000000-deadbeef.json');
    expect(parseChatFileName(name)).toEqual({ sentAt: 1_700_000_000_000 });
    expect(mintChatFileName(42, 'deadbeef')).toBe('0000000000042-deadbeef.json');
    expect(mintChatFileName(1)).toMatch(/^0000000000001-[0-9a-f]{8}\.json$/u);
    expect(parseChatFileName('nope.json')).toBeNull();
    expect(mintChatFileName(1, 'aaaaaaaa') < mintChatFileName(2, '00000000')).toBe(true);
  });

  it('extracts names and peers from URLs', () => {
    expect(fileNameFromUrl(`pubky://${ME}/pub/chat/v0/${FOLDER}/1700000000000-deadbeef.json`)).toBe(
      '1700000000000-deadbeef.json',
    );
    expect(peerFromConversationUrl(chatPrivConversationUrl(ME, PEER))).toBe(PEER);
    expect(peerFromConversationUrl(`pubky://${ME}/priv/chat/v0/conversations/short.json`)).toBeNull();
  });

  it('classifies event-stream paths', () => {
    expect(parseChatEventPath('/pub/chat/v0/key.json')).toEqual({ key: true });
    expect(parseChatEventPath(`/pub/chat/v0/${FOLDER}/1700000000000-deadbeef.json`)).toEqual({
      folderId: FOLDER,
      fileName: '1700000000000-deadbeef.json',
    });
    expect(parseChatEventPath(`/pub/chat/v0/${FOLDER}/other.txt`)).toBeNull();
    expect(parseChatEventPath('/pub/pubky.app/posts/x')).toBeNull();
  });
});
