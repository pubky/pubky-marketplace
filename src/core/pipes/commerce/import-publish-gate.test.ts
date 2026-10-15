import { describe, expect, it } from 'vitest';
import {
  gateBlocksListing,
  gateNotice,
  keptLiveFailureCode,
  keptLiveLine,
  keptLiveOf,
  keptLiveSummary,
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

describe('kept-live copy', () => {
  it("says what to fix in the gate's own words, and round-trips the failure code with the skipped changes", () => {
    expect(keptLiveLine('no-method')).toBe('kept live; fix payment method to keep publishing');
    expect(keptLiveLine('no-delivery-key')).toBe('kept live; fix delivery key to keep publishing');
    expect(keptLiveLine('unverified')).toBe('kept live; fix payment settings to keep publishing');
    expect(keptLiveOf(keptLiveFailureCode('no-method', []))).toEqual({ reason: 'no-method', skipped: [] });
    expect(keptLiveOf(keptLiveFailureCode('no-delivery-key', ['fulfillment', 'sale']))).toEqual({
      reason: 'no-delivery-key',
      skipped: ['fulfillment', 'sale'],
    });
    expect(keptLiveOf('paused:no-method')).toBeNull();
    expect(keptLiveOf('kept_live:nonsense')).toBeNull();
    expect(keptLiveOf(undefined)).toBeNull();
  });

  it('summarises how many stayed live and how many changes were skipped', () => {
    expect(keptLiveSummary(1, 'no-method', 0)).toBe('1 listing was kept live; fix payment method to keep publishing.');
    expect(keptLiveSummary(3, 'no-delivery-key', 1)).toBe(
      '3 listings were kept live; fix delivery key to keep publishing. 1 change was skipped.',
    );
  });

  it('tells the dry run what happens to each kind of listing', () => {
    expect(gateNotice('no-method', { pausing: 2, keptLive: 0 }).title).toMatch(/^Listings will be saved as paused\./);
    expect(gateNotice('no-method', { pausing: 2, keptLive: 1 }).title).toMatch(
      /^New and paused listings will be saved as paused\./,
    );
    expect(gateNotice('no-method', { pausing: 0, keptLive: 3 }).title).toMatch(/^Listings that are live stay live\./);
  });
});
