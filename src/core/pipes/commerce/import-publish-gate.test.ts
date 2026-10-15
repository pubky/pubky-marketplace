import { describe, expect, it } from 'vitest';
import {
  gateBlocksListing,
  gateNotice,
  pausedFailureCode,
  pausedReasonOf,
  pausedResultText,
  pausedSummary,
  payloadShips,
} from './import-publish-gate';

describe('gateBlocksListing', () => {
  it('lets a payment block stop every listing, and a delivery-key block stop only listings that ship', () => {
    for (const reason of ['no-method', 'unverified', 'session', 'unsigned'] as const) {
      expect(gateBlocksListing(reason, false)).toBe(true);
      expect(gateBlocksListing(reason, true)).toBe(true);
    }
    for (const reason of ['no-delivery-key', 'delivery-key-unverified'] as const) {
      expect(gateBlocksListing(reason, true)).toBe(true);
      expect(gateBlocksListing(reason, false)).toBe(false);
    }
  });
});

describe('payloadShips', () => {
  const record = (fulfillmentMethods: string[]) => ({
    extraFields: { record_json: JSON.stringify({ fulfillmentMethods }) },
  });

  it('reads shipping from the record a row carries', () => {
    expect(payloadShips(record(['physical']))).toBe(true);
    expect(payloadShips(record(['shipping']))).toBe(true);
    expect(payloadShips(record(['shipping', 'pickup']))).toBe(true);
    expect(payloadShips(record(['digital']))).toBe(false);
    expect(payloadShips(record(['pickup']))).toBe(false);
  });

  it('treats a row without a record, or with an unreadable one, as a listing that ships', () => {
    expect(payloadShips({})).toBe(true);
    expect(payloadShips({ extraFields: { country_code: 'CH' } })).toBe(true);
    expect(payloadShips({ extraFields: { record_json: 'not json' } })).toBe(true);
    expect(payloadShips({ extraFields: { record_json: '{}' } })).toBe(true);
  });
});

describe('paused copy', () => {
  it('round-trips the failure code and explains the pause in the result CSV, the summary and the dry run', () => {
    expect(pausedReasonOf(pausedFailureCode('no-method'))).toBe('no-method');
    expect(pausedReasonOf('photo_required')).toBeNull();
    expect(pausedReasonOf('paused:nonsense')).toBeNull();
    expect(pausedReasonOf(undefined)).toBeNull();
    expect(pausedResultText('no-delivery-key')).toBe('paused, no delivery key published');
    expect(pausedSummary(1, 'no-method')).toBe('1 listing was saved as paused: no payment method set up.');
    expect(pausedSummary(3, 'no-delivery-key')).toBe('3 listings were saved as paused: no delivery key published.');
    expect(gateNotice('no-method').title).toMatch(/^Listings will be saved as paused\. Configure a payment method/);
    expect(gateNotice('no-delivery-key').body).toMatch(/delivery key/);
  });
});
