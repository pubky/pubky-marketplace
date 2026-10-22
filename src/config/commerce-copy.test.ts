import { describe, expect, it } from 'vitest';
import {
  CONNECTOR_SHARE_CONSENT_COPY,
  CONNECTOR_SHARE_CONSENT_VERSION,
  REVIEW_MODERATION_COPY,
  REVIEW_MODERATION_REASON_FALLBACK,
  reviewModerationReasonCopy,
} from './commerce-copy';

describe('reviewModerationReasonCopy', () => {
  it.each([
    ['hatespeech', 'Hate speech'],
    ['harassement', 'Harassment'],
    ['illegal_activities', 'Illegal activity'],
    ['review_fraud', 'Fraud'],
  ])('maps the moderator label %s to %s', (label, copy) => {
    expect(reviewModerationReasonCopy(label)).toBe(copy);
  });

  it.each(['brand_new_label', '', 'constructor', 'toString'])(
    'falls back to the neutral reason for the unknown label %j',
    (label) => {
      expect(reviewModerationReasonCopy(label)).toBe(REVIEW_MODERATION_REASON_FALLBACK);
    },
  );

  it('builds the hidden-text line from the label', () => {
    expect(REVIEW_MODERATION_COPY.textHidden('hatespeech')).toBe(
      'Hidden by Pubky Market moderation · Reason: Hate speech',
    );
  });
});

describe('CONNECTOR_SHARE_CONSENT_COPY', () => {
  const { helper } = CONNECTOR_SHARE_CONSENT_COPY;

  it('says the marketplace service reads the address and sends it to the store', () => {
    expect(helper).toContain('the Pubky Market service decrypts your address and sends it to that store');
    expect(helper).toContain('the service can read this one');
  });

  it('names what is sent and what is not', () => {
    expect(helper).toContain('your name, address and phone number (if you gave one)');
    expect(helper).toContain('not your email or your Pubky ID');
  });

  it('says the service deletes its copy but cannot delete the store copy', () => {
    expect(helper).toContain('once the store has the order, or when the order ends');
    expect(helper).toContain('cannot delete the copy the store keeps');
  });

  it('never says the address is encrypted to the store', () => {
    expect(helper).not.toMatch(/encrypted to that store/i);
  });

  it('is version 3, so stored consent records the corrected wording', () => {
    expect(CONNECTOR_SHARE_CONSENT_VERSION).toBe(3);
  });
});
