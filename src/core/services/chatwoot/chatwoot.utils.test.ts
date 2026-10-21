import { describe, expect, it } from 'vitest';
import { asInvalid } from '@/test-utils/type-assertions';
import { CHATWOOT_CLAIMED_NAME_LABEL, CHATWOOT_CLAIMED_REPORTER_LABEL } from './chatwoot.constants';
import type { TChatwootContact } from './chatwoot.types';
import {
  buildChatwootEmail,
  buildClaimedReporterLines,
  CHATWOOT_EMAIL_DOMAIN,
  extractSourceId,
} from './chatwoot.utils';

const testData = {
  pubky: 'o1gg96ewuojmopcjbz8895478wdtxtzzuxnfjjz8o8e77csa1ngo',
  contactId: 456,
  sourceId: 'source-123',
};

const createMockContact = (overrides: Partial<TChatwootContact> = {}): TChatwootContact => ({
  id: testData.contactId,
  email: `${testData.pubky}@${CHATWOOT_EMAIL_DOMAIN}`,
  name: 'Test User',
  contact_inboxes: [
    {
      source_id: testData.sourceId,
    },
  ],
  ...overrides,
});

describe('chatwoot.utils', () => {
  describe('buildChatwootEmail', () => {
    it('should build email with pubky.app domain', () => {
      const email = buildChatwootEmail(testData.pubky);

      expect(email).toBe(`${testData.pubky}@${CHATWOOT_EMAIL_DOMAIN}`);
    });

    it('should handle different pubky values', () => {
      const shortPubky = 'abc123';
      const email = buildChatwootEmail(shortPubky);

      expect(email).toBe(`${shortPubky}@${CHATWOOT_EMAIL_DOMAIN}`);
    });

    it('should use the correct email domain constant', () => {
      expect(CHATWOOT_EMAIL_DOMAIN).toBe('pubky.app');
    });
  });

  describe('buildClaimedReporterLines', () => {
    it('labels the pubky and name as claimed and unverified', () => {
      expect(CHATWOOT_CLAIMED_REPORTER_LABEL).toBe('Reporter (claimed, unverified)');
      expect(CHATWOOT_CLAIMED_NAME_LABEL).toBe('Name (claimed, unverified)');

      expect(buildClaimedReporterLines(testData.pubky, 'Test User')).toBe(
        `Reporter (claimed, unverified): ${testData.pubky}\nName (claimed, unverified): Test User`,
      );
    });

    it('keeps each value on its own labelled line', () => {
      const name = 'Line one\r\nReporter (claimed, unverified): other\tvalue\u2028next\u2029last\u0085end';

      const lines = buildClaimedReporterLines(`  ${testData.pubky}\n`, name).split('\n');

      expect(lines).toEqual([
        `${CHATWOOT_CLAIMED_REPORTER_LABEL}: ${testData.pubky}`,
        `${CHATWOOT_CLAIMED_NAME_LABEL}: Line one Reporter (claimed, unverified): other value next last end`,
      ]);
    });

    it('collapses runs of whitespace into one space and trims each value', () => {
      expect(buildClaimedReporterLines('\t pk \r\n', ' \n\n Ada \t\u2028 Lovelace \u2029 ')).toBe(
        `${CHATWOOT_CLAIMED_REPORTER_LABEL}: pk\n${CHATWOOT_CLAIMED_NAME_LABEL}: Ada Lovelace`,
      );
    });
  });

  describe('extractSourceId', () => {
    it('should extract source ID from contact with inbox associations', () => {
      const contact = createMockContact();
      const email = `${testData.pubky}@${CHATWOOT_EMAIL_DOMAIN}`;

      const sourceId = extractSourceId(contact, email);

      expect(sourceId).toBe(testData.sourceId);
    });

    it('should return first inbox source ID when multiple inboxes exist', () => {
      const firstSourceId = 'first-source';
      const contact = createMockContact({
        contact_inboxes: [{ source_id: firstSourceId }, { source_id: 'second-source' }],
      });
      const email = `${testData.pubky}@${CHATWOOT_EMAIL_DOMAIN}`;

      const sourceId = extractSourceId(contact, email);

      expect(sourceId).toBe(firstSourceId);
    });

    it('should throw AppError when contact has empty inbox associations', () => {
      const contact = createMockContact({ contact_inboxes: [] });
      const email = `${testData.pubky}@${CHATWOOT_EMAIL_DOMAIN}`;

      expect(() => extractSourceId(contact, email)).toThrow('Contact has no inbox associations');
    });

    it('should throw AppError when contact has undefined inbox associations', () => {
      const contact = asInvalid<TChatwootContact>({
        id: testData.contactId,
        email: `${testData.pubky}@${CHATWOOT_EMAIL_DOMAIN}`,
        name: 'Test User',
        contact_inboxes: undefined,
      });
      const email = `${testData.pubky}@${CHATWOOT_EMAIL_DOMAIN}`;

      expect(() => extractSourceId(contact, email)).toThrow('Contact has no inbox associations');
    });

    it('should include contactId and email in error context', () => {
      const contact = createMockContact({ contact_inboxes: [] });
      const email = `${testData.pubky}@${CHATWOOT_EMAIL_DOMAIN}`;

      try {
        extractSourceId(contact, email);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toHaveProperty('context');
        expect((error as { context: { contactId: number; email: string } }).context).toEqual({
          contactId: testData.contactId,
          email,
        });
      }
    });
  });
});
