import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ShipFromAddress, SHIPPO_FAILURE_REASONS } from '@/libs/commerce/shipping';
import { ShippoService } from './shippo';

const SHIP_FROM: ShipFromAddress = {
  name: "Igor's Olive Farm",
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
  name: 'Sentinel Buyer',
  line1: '10 Downing Street',
  line2: '',
  city: 'London',
  region: '',
  postalCode: 'SW1A 2AA',
  countryCode: 'GB',
};

const PARCEL = { weightGrams: 900, lengthMm: 300, widthMm: 200, heightMm: 150 };
const TOKEN = 'shippo_test_1234567890';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const calls = () => vi.mocked(fetch).mock.calls;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ShippoService.quoteRates', () => {
  it('posts the shipment straight to Shippo with the seller token and parses the rates', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(201, {
        rates: [
          {
            object_id: 'rate_1',
            provider: 'USPS',
            servicelevel: { name: 'Ground' },
            amount: '7.85',
            currency: 'USD',
            estimated_days: 3,
          },
        ],
      }),
    );

    const rates = await ShippoService.quoteRates({
      apiKey: TOKEN,
      shipFrom: SHIP_FROM,
      destination: DESTINATION,
      parcel: PARCEL,
    });

    expect(rates).toEqual([
      {
        rateId: 'rate_1',
        provider: 'USPS',
        servicelevel: 'Ground',
        amount: '7.85',
        currency: 'USD',
        estimatedDays: 3,
        durationTerms: null,
      },
    ]);
    const [url, init] = calls()[0]!;
    expect(url).toBe('https://api.goshippo.com/shipments/');
    expect(init?.headers).toMatchObject({ Authorization: `ShippoToken ${TOKEN}` });
    expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      async: false,
      address_to: { name: 'Sentinel Buyer', street1: '10 Downing Street', zip: 'SW1A 2AA', country: 'GB' },
      address_from: { street1: 'Maslinska 1', country: 'HR' },
      parcels: [{ length: '30.0', width: '20.0', height: '15.0', distance_unit: 'cm', weight: '900', mass_unit: 'g' }],
    });
    expect(body.address_to).not.toHaveProperty('street2');
    expect(body.address_to).not.toHaveProperty('state');
  });

  it.each([
    [401, SHIPPO_FAILURE_REASONS.keyInvalid, {}],
    [403, SHIPPO_FAILURE_REASONS.keyInvalid, {}],
    [400, SHIPPO_FAILURE_REASONS.rejected, { address_to: ['bad'] }],
    [503, SHIPPO_FAILURE_REASONS.unavailable, { detail: 'down' }],
    [429, SHIPPO_FAILURE_REASONS.unavailable, { detail: 'slow down' }],
  ])('maps HTTP %i to %s', async (status, reason, body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(status, body));
    await expect(
      ShippoService.quoteRates({ apiKey: TOKEN, shipFrom: SHIP_FROM, destination: DESTINATION, parcel: PARCEL }),
    ).rejects.toMatchObject({ context: { reason } });
  });

  it('refuses a quote with no rates and reports Shippo as unavailable on a transport failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(201, { rates: [], messages: [{ text: 'no service' }] }));
    await expect(
      ShippoService.quoteRates({ apiKey: TOKEN, shipFrom: SHIP_FROM, destination: DESTINATION, parcel: PARCEL }),
    ).rejects.toMatchObject({ context: { reason: SHIPPO_FAILURE_REASONS.rejected } });

    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(
      ShippoService.quoteRates({ apiKey: TOKEN, shipFrom: SHIP_FROM, destination: DESTINATION, parcel: PARCEL }),
    ).rejects.toBeDefined();
  });

  it('never puts the token, the address or Shippo text into an error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(400, { messages: [{ text: 'Sentinel Buyer at 10 Downing Street is not valid' }] }),
    );
    const error = await ShippoService.quoteRates({
      apiKey: TOKEN,
      shipFrom: SHIP_FROM,
      destination: DESTINATION,
      parcel: PARCEL,
    }).catch((caught: unknown) => caught);
    const rendered = JSON.stringify({
      message: (error as Error).message,
      context: (error as { context?: unknown }).context,
    });
    expect(rendered).not.toContain('Downing');
    expect(rendered).not.toContain('Sentinel');
    expect(rendered).not.toContain(TOKEN);
  });
});

describe('ShippoService.purchaseLabel', () => {
  it('re-reads the rate, buys it and returns the label', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        json(200, {
          object_id: 'rate_1',
          provider: 'USPS',
          servicelevel: { name: 'Ground' },
          amount: '7.85',
          currency: 'USD',
        }),
      )
      .mockResolvedValueOnce(
        json(201, {
          object_id: 'txn_1',
          status: 'SUCCESS',
          tracking_number: 'TRACK123',
          tracking_url_provider: 'https://track.example/TRACK123',
          label_url: 'https://deliver.goshippo.com/label_1.pdf',
        }),
      );

    const label = await ShippoService.purchaseLabel({ apiKey: TOKEN, rateId: 'rate_1' });

    expect(label).toEqual({
      transactionId: 'txn_1',
      carrier: 'USPS',
      servicelevel: 'Ground',
      amount: '7.85',
      currency: 'USD',
      trackingNumber: 'TRACK123',
      trackingUrl: 'https://track.example/TRACK123',
      labelUrl: 'https://deliver.goshippo.com/label_1.pdf',
    });
    expect(calls()[0]![0]).toBe('https://api.goshippo.com/rates/rate_1');
    expect(calls()[1]![0]).toBe('https://api.goshippo.com/transactions/');
    expect(JSON.parse(String(calls()[1]![1]?.body))).toEqual({ rate: 'rate_1', label_file_type: 'PDF', async: false });
  });

  it('says the rate is gone on 404 and never buys', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(404, { detail: 'Not found' }));
    await expect(ShippoService.purchaseLabel({ apiKey: TOKEN, rateId: 'rate_x' })).rejects.toMatchObject({
      context: { reason: SHIPPO_FAILURE_REASONS.rejected },
    });
    expect(calls()).toHaveLength(1);
  });

  it('treats a non-SUCCESS transaction as rejected and a SUCCESS without tracking as unavailable', async () => {
    const rate = json(200, { object_id: 'rate_1', provider: 'USPS', servicelevel: { name: 'Ground' } });
    vi.mocked(fetch)
      .mockResolvedValueOnce(rate.clone())
      .mockResolvedValueOnce(json(201, { object_id: 't', status: 'ERROR', messages: [{ text: 'declined' }] }));
    await expect(ShippoService.purchaseLabel({ apiKey: TOKEN, rateId: 'rate_1' })).rejects.toMatchObject({
      context: { reason: SHIPPO_FAILURE_REASONS.rejected },
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce(rate.clone())
      .mockResolvedValueOnce(json(201, { object_id: 't', status: 'SUCCESS' }));
    await expect(ShippoService.purchaseLabel({ apiKey: TOKEN, rateId: 'rate_1' })).rejects.toMatchObject({
      context: { reason: SHIPPO_FAILURE_REASONS.unavailable },
    });
  });
});
