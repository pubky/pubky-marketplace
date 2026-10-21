import { describe, expect, it } from 'vitest';
import { REVIEW_MODERATION_COPY, REVIEW_MODERATION_REASON_FALLBACK, reviewModerationReasonCopy } from './commerce-copy';

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
