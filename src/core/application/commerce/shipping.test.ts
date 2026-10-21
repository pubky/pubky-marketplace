import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_NAME } from '@/config/database';
import type { ShipFromAddress } from '@/libs/commerce/shipping';
import {
  deliveryKeyStoreDbName,
  getDeviceRecord,
  resetDeliveryKeyStoreForTests,
} from '@/libs/crypto/delivery-key-store';
import { ShippoService } from '@/services/shippo/shippo';
import { CommerceShippingApplication } from './shipping';

vi.mock('@/services/shippo/shippo', () => ({
  ShippoService: { quoteRates: vi.fn(), purchaseLabel: vi.fn() },
}));

const OWNER = 'o'.repeat(52);
const OTHER = 'p'.repeat(52);
const TOKEN = 'shippo_test_1234567890';
const SHIP_FROM: ShipFromAddress = {
  name: 'Olive Grove Farm',
  line1: 'Maslinska 1',
  line2: '',
  city: 'Split',
  region: '',
  postalCode: '21000',
  countryCode: 'HR',
  phone: '',
  email: '',
};
const DESTINATION = {
  name: 'Buyer',
  line1: '1 Market Street',
  line2: '',
  city: 'New York',
  region: 'NY',
  postalCode: '10001',
  countryCode: 'US',
};
const PARCEL = { weightGrams: 900, lengthMm: 300, widthMm: 200, heightMm: 150 };
const BOUGHT = {
  transactionId: 'txn_1',
  carrier: 'USPS',
  servicelevel: 'Ground',
  amount: '7.85',
  currency: 'USD',
  trackingNumber: 'TRACK123',
  trackingUrl: null,
  labelUrl: 'https://deliver.goshippo.com/label_1.pdf',
};

beforeEach(async () => {
  await resetDeliveryKeyStoreForTests();
  vi.mocked(ShippoService.quoteRates).mockReset();
  vi.mocked(ShippoService.purchaseLabel).mockReset().mockResolvedValue(BOUGHT);
});

describe('CommerceShippingApplication configuration', () => {
  it('is empty until saved, then reports only that a token exists', async () => {
    expect(await CommerceShippingApplication.getMyConfig(OWNER)).toBeNull();
    const saved = await CommerceShippingApplication.putMyConfig(OWNER, { shippoApiKey: TOKEN, shipFrom: SHIP_FROM });
    expect(saved).toMatchObject({ shippoApiKeySet: true, shipFrom: SHIP_FROM });
    expect(JSON.stringify(saved)).not.toContain(TOKEN);
    expect(await CommerceShippingApplication.getMyConfig(OWNER)).toEqual(saved);
    expect(await CommerceShippingApplication.getMyConfig(OTHER)).toBeNull();
  });

  it('keeps the token when it is omitted and clears it when empty', async () => {
    await CommerceShippingApplication.putMyConfig(OWNER, { shippoApiKey: TOKEN, shipFrom: SHIP_FROM });
    const kept = await CommerceShippingApplication.putMyConfig(OWNER, { shipFrom: { ...SHIP_FROM, city: 'Zagreb' } });
    expect(kept).toMatchObject({ shippoApiKeySet: true });
    expect(kept.shipFrom?.city).toBe('Zagreb');
    const cleared = await CommerceShippingApplication.putMyConfig(OWNER, { shippoApiKey: '', shipFrom: SHIP_FROM });
    expect(cleared.shippoApiKeySet).toBe(false);
  });

  it('rejects a token that is not a Shippo token and stores nothing', async () => {
    await expect(
      CommerceShippingApplication.putMyConfig(OWNER, { shippoApiKey: 'sk_live_not_shippo', shipFrom: SHIP_FROM }),
    ).rejects.toThrow(/shippo_/);
    expect(await CommerceShippingApplication.getMyConfig(OWNER)).toBeNull();
  });

  it('holds the token and ship-from address encrypted at rest', async () => {
    await CommerceShippingApplication.putMyConfig(OWNER, { shippoApiKey: TOKEN, shipFrom: SHIP_FROM });
    const opened = await getDeviceRecord(OWNER, 'shipping-config');
    expect(new TextDecoder().decode(opened!)).toContain(TOKEN);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(deliveryKeyStoreDbName(DB_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<Uint8Array[]>((resolve, reject) => {
      const request = db.transaction('records', 'readonly').objectStore('records').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    const raw = Buffer.concat(rows.map((row) => Buffer.from(row)));
    expect(raw.includes(Buffer.from(TOKEN))).toBe(false);
    expect(raw.includes(Buffer.from('Maslinska'))).toBe(false);
  });
});

describe('CommerceShippingApplication quote and purchase', () => {
  it('quotes with the stored token and ship-from address and the decrypted destination', async () => {
    await CommerceShippingApplication.putMyConfig(OWNER, { shippoApiKey: TOKEN, shipFrom: SHIP_FROM });
    vi.mocked(ShippoService.quoteRates).mockResolvedValueOnce([]);
    await CommerceShippingApplication.quoteRates({ owner: OWNER, destination: DESTINATION, parcel: PARCEL });
    expect(ShippoService.quoteRates).toHaveBeenCalledWith({
      apiKey: TOKEN,
      shipFrom: SHIP_FROM,
      destination: DESTINATION,
      parcel: PARCEL,
    });
  });

  it('refuses to quote without a token or a ship-from address, and without calling Shippo', async () => {
    await expect(
      CommerceShippingApplication.quoteRates({ owner: OWNER, destination: DESTINATION, parcel: PARCEL }),
    ).rejects.toThrow(/Configure your Shippo/);
    await CommerceShippingApplication.putMyConfig(OWNER, { shippoApiKey: TOKEN, shipFrom: null });
    await expect(
      CommerceShippingApplication.quoteRates({ owner: OWNER, destination: DESTINATION, parcel: PARCEL }),
    ).rejects.toThrow(/ship-from/);
    expect(ShippoService.quoteRates).not.toHaveBeenCalled();
  });

  it('refuses an out-of-range parcel before any call', async () => {
    await CommerceShippingApplication.putMyConfig(OWNER, { shippoApiKey: TOKEN, shipFrom: SHIP_FROM });
    await expect(
      CommerceShippingApplication.quoteRates({
        owner: OWNER,
        destination: DESTINATION,
        parcel: { ...PARCEL, weightGrams: 0 },
      }),
    ).rejects.toThrow(/parcel/);
    expect(ShippoService.quoteRates).not.toHaveBeenCalled();
  });

  it('buys once per order, keeps the label on this device, and returns the stored label on a repeat', async () => {
    await CommerceShippingApplication.putMyConfig(OWNER, { shippoApiKey: TOKEN, shipFrom: SHIP_FROM });
    const first = await CommerceShippingApplication.purchaseLabel({
      owner: OWNER,
      orderId: 'order-1',
      rateId: 'rate_1',
    });
    expect(first).toMatchObject(BOUGHT);
    expect(first.purchasedAt).toMatch(/^\d{4}-/);
    const again = await CommerceShippingApplication.purchaseLabel({
      owner: OWNER,
      orderId: 'order-1',
      rateId: 'rate_2',
    });
    expect(again).toEqual(first);
    expect(ShippoService.purchaseLabel).toHaveBeenCalledTimes(1);
    expect(await CommerceShippingApplication.getLabel(OWNER, 'order-1')).toEqual(first);
    expect(await CommerceShippingApplication.getLabel(OWNER, 'order-2')).toBeNull();
    expect(await CommerceShippingApplication.getLabel(OTHER, 'order-1')).toBeNull();
    await CommerceShippingApplication.deleteLabel(OWNER, 'order-1');
    expect(await CommerceShippingApplication.getLabel(OWNER, 'order-1')).toBeNull();
  });

  it('does not buy without a stored token', async () => {
    await expect(
      CommerceShippingApplication.purchaseLabel({ owner: OWNER, orderId: 'order-1', rateId: 'rate_1' }),
    ).rejects.toThrow(/Configure your Shippo/);
    expect(ShippoService.purchaseLabel).not.toHaveBeenCalled();
  });
});
