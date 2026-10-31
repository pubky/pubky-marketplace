import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MarketplaceOrder } from '@/services/marketplace/marketplace';
import {
  createBitcoinQuotedOrderFixture,
  createOrderFixture,
  createUsdtOrderFixture,
} from '@/test/fixtures/commerce/orders';
import { useMarketplaceOrderAction } from './useMarketplaceOrderAction';
import { marketplaceOrderActionDefaults, marketplaceOrderActionSchema } from './useMarketplaceOrderAction.types';

const sats = (amountMinor: number) => ({ amountMinor, currency: 'SAT', exponent: 0 });
const btc = (amountMinor: number) => ({ amountMinor, currency: 'BTC', exponent: 8 });
const eur = (amountMinor: number) => ({ amountMinor, currency: 'EUR', exponent: 2 });

describe('useMarketplaceOrderAction return request', () => {
  // `return.request` caps the amount at the order's merchandise total in its
  // own units, whichever rail paid it.
  const cases: Array<[string, MarketplaceOrder, string, number]> = [
    [
      'a USDT order priced in satoshis',
      createUsdtOrderFixture('delivered', {
        paymentMethod: 'paykit',
        subtotal: sats(138_000),
        shipping: sats(12_000),
        total: sats(150_000),
        paymentAmountMinor: 41_250_000,
      }),
      '150000',
      150_000,
    ],
    [
      'a USDT order priced in euros',
      createUsdtOrderFixture('delivered', {
        paymentMethod: 'paykit',
        subtotal: eur(12_500),
        shipping: eur(1_200),
        total: eur(13_700),
        paymentAmountMinor: 148_539_999,
      }),
      '137.00',
      13_700,
    ],
    [
      'a Bitcoin order priced in satoshis, without its payment code',
      createOrderFixture('delivered', {
        paymentMethod: 'bitcoin',
        paykitTotalSats: 1_255,
        merchandiseTotal: btc(1_000),
        bitcoinPayable: sats(1_255),
        subtotal: btc(1_000),
        shipping: btc(0),
        total: btc(1_255),
      }),
      '1000',
      1_000,
    ],
    [
      'a Bitcoin order priced in dollars',
      {
        ...createBitcoinQuotedOrderFixture(),
        state: 'delivered',
        bitcoinPayable: sats(3_000),
        paykitTotalSats: 3_000,
      },
      '137.00',
      13_700,
    ],
  ];

  it.each(cases)('asks for %s in the order units', async (_name, order, prefill, requestedAmountMinor) => {
    const actOnOrder = vi.fn(async () => true);
    const { result } = renderHook(() => useMarketplaceOrderAction(order, actOnOrder));

    act(() => {
      result.current.setAction('return', { reason: 'Not as described' });
    });
    expect(result.current.form.getValues('amount')).toBe(prefill);
    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(true);
    expect(actOnOrder).toHaveBeenCalledWith(order, 'return.request', {
      reason: 'Not as described',
      requestedAmountMinor,
    });
  });
});

describe('useMarketplaceOrderAction ship action', () => {
  it('starts with no carrier chosen, so no carrier is recorded unless the seller picks one', () => {
    expect(marketplaceOrderActionDefaults.carrierChoice).toBe('');
    const { result } = renderHook(() =>
      useMarketplaceOrderAction(
        createOrderFixture('paid'),
        vi.fn(async () => true),
      ),
    );
    act(() => {
      result.current.setAction('ship');
    });
    expect(result.current.form.getValues('carrierChoice')).toBe('');
  });

  it('refuses to ship until a carrier is chosen and sends nothing', async () => {
    const order = createOrderFixture('paid');
    const actOnOrder = vi.fn(async () => true);
    const { result } = renderHook(() => {
      const action = useMarketplaceOrderAction(order, actOnOrder);
      void action.form.formState.errors;
      return action;
    });

    act(() => {
      result.current.setAction('ship', { trackingNumber: 'RN123456785GB' });
    });
    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(false);
    expect(actOnOrder).not.toHaveBeenCalled();
    expect(result.current.form.formState.errors.carrierChoice?.message).toBe('Select a carrier.');
  });

  it('asks for a carrier only when shipping', () => {
    const base = { ...marketplaceOrderActionDefaults, reason: 'Changed my mind' };
    expect(marketplaceOrderActionSchema.safeParse({ ...base, action: 'ship' }).success).toBe(false);
    expect(marketplaceOrderActionSchema.safeParse({ ...base, action: 'ship', carrierChoice: 'other' }).success).toBe(
      true,
    );
    expect(marketplaceOrderActionSchema.safeParse({ ...base, action: 'cancel' }).success).toBe(true);
  });

  it('sends the curated carrier by its canonical display name', async () => {
    const order = createOrderFixture('paid');
    const actOnOrder = vi.fn(async () => true);
    const { result } = renderHook(() => useMarketplaceOrderAction(order, actOnOrder));

    act(() => {
      result.current.setAction('ship', { carrierChoice: 'royal-mail', trackingNumber: 'RN123456785GB' });
    });
    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(true);
    expect(actOnOrder).toHaveBeenCalledWith(order, 'fulfillment.ship', {
      carrier: 'Royal Mail',
      trackingNumber: 'RN123456785GB',
    });
  });

  it('passes an "Other" carrier through as the seller\'s own free text', async () => {
    const order = createOrderFixture('paid');
    const actOnOrder = vi.fn(async () => true);
    const { result } = renderHook(() => useMarketplaceOrderAction(order, actOnOrder));

    act(() => {
      result.current.setAction('ship', {
        carrierChoice: 'other',
        carrier: 'Correio da Aldeia',
        trackingNumber: 'CA-0001',
      });
    });
    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(true);
    expect(actOnOrder).toHaveBeenCalledWith(order, 'fulfillment.ship', {
      carrier: 'Correio da Aldeia',
      trackingNumber: 'CA-0001',
    });
  });

  it('ships without a tracking number and leaves the field out of the command', async () => {
    const order = createOrderFixture('paid');
    const actOnOrder = vi.fn(async () => true);
    const { result } = renderHook(() => useMarketplaceOrderAction(order, actOnOrder));

    act(() => {
      result.current.setAction('ship', { carrierChoice: 'usps', trackingNumber: '   ' });
    });
    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(true);
    expect(actOnOrder).toHaveBeenCalledWith(order, 'fulfillment.ship', { carrier: 'USPS' });
  });

  it('records the carrier as Other when the seller names none', async () => {
    const order = createOrderFixture('paid');
    const actOnOrder = vi.fn(async () => true);
    const { result } = renderHook(() => useMarketplaceOrderAction(order, actOnOrder));

    act(() => {
      result.current.setAction('ship', { carrierChoice: 'other', carrier: '', trackingNumber: '' });
    });
    await act(async () => {
      await result.current.submit();
    });
    expect(actOnOrder).toHaveBeenCalledWith(order, 'fulfillment.ship', { carrier: 'Other' });

    act(() => {
      result.current.setAction('ship', { carrierChoice: 'other', carrier: '', trackingNumber: 'X-1' });
    });
    await act(async () => {
      await result.current.submit();
    });
    expect(actOnOrder).toHaveBeenLastCalledWith(order, 'fulfillment.ship', { carrier: 'Other', trackingNumber: 'X-1' });
  });
});

describe('useMarketplaceOrderAction refund', () => {
  const paypalOrder = createOrderFixture('return_received', {
    paymentMethod: 'paypal',
    total: { amountMinor: 250, currency: 'USD', exponent: 2 },
  });

  it('prefills the order total and records a smaller PayPal refund', async () => {
    const actOnOrder = vi.fn(async () => true);
    const { result } = renderHook(() => useMarketplaceOrderAction(paypalOrder, actOnOrder));

    act(() => {
      result.current.setAction('refund');
    });
    expect(result.current.form.getValues('amount')).toBe('2.50');

    act(() => {
      result.current.form.setValue('amount', '1.89');
      result.current.form.setValue('transactionId', 'PAYPALREFUND189');
    });
    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(true);
    expect(actOnOrder).toHaveBeenCalledWith(paypalOrder, 'refund.record_external', {
      amountMinor: 189,
      transactionId: 'PAYPALREFUND189',
    });
  });

  it('refuses a refund above the order total', async () => {
    const actOnOrder = vi.fn(async () => true);
    const { result } = renderHook(() => useMarketplaceOrderAction(paypalOrder, actOnOrder));

    act(() => {
      result.current.setAction('refund', { amount: '2.51', transactionId: 'PAYPALREFUND251' });
    });
    await act(async () => {
      await result.current.submit();
    });

    expect(actOnOrder).not.toHaveBeenCalled();
    expect(result.current.form.getFieldState('amount').error?.message).toBe('Enter a refund up to the order total.');
  });

  describe('after a PayPal partial refund', () => {
    const partialOrder = createOrderFixture('return_received', {
      paymentMethod: 'paypal',
      total: { amountMinor: 250, currency: 'USD', exponent: 2 },
      externalRefund: { amountMinor: 189, transactionId: '9RF12345AB678901C', recordedAt: '2026-09-24T18:00:00.000Z' },
    });

    it('prefills the remaining amount and records the PayPal sum plus it', async () => {
      const actOnOrder = vi.fn(async () => true);
      const { result } = renderHook(() => useMarketplaceOrderAction(partialOrder, actOnOrder));

      act(() => {
        result.current.setAction('refund', { transactionId: 'BANKTRANSFER061' });
      });
      expect(result.current.form.getValues('amount')).toBe('0.61');
      let succeeded = false;
      await act(async () => {
        succeeded = await result.current.submit();
      });

      expect(succeeded).toBe(true);
      expect(actOnOrder).toHaveBeenCalledWith(partialOrder, 'refund.record_external', {
        amountMinor: 250,
        transactionId: 'BANKTRANSFER061',
      });
    });

    it('closes the order at the PayPal amount when nothing else was refunded', async () => {
      const actOnOrder = vi.fn(async () => true);
      const { result } = renderHook(() => useMarketplaceOrderAction(partialOrder, actOnOrder));

      act(() => {
        result.current.setAction('refund', { amount: '0', transactionId: '9RF12345AB678901C' });
      });
      await act(async () => {
        await result.current.submit();
      });

      expect(actOnOrder).toHaveBeenCalledWith(partialOrder, 'refund.record_external', {
        amountMinor: 189,
        transactionId: '9RF12345AB678901C',
      });
    });

    it('refuses more than PayPal left unrefunded', async () => {
      const actOnOrder = vi.fn(async () => true);
      const { result } = renderHook(() => useMarketplaceOrderAction(partialOrder, actOnOrder));

      act(() => {
        result.current.setAction('refund', { amount: '0.62', transactionId: 'BANKTRANSFER062' });
      });
      await act(async () => {
        await result.current.submit();
      });

      expect(actOnOrder).not.toHaveBeenCalled();
      expect(result.current.form.getFieldState('amount').error?.message).toBe(
        'Enter a refund up to the amount PayPal has not refunded.',
      );
    });
  });

  it('records a Bitcoin refund as integer satoshis of the payable', async () => {
    const order = createOrderFixture('return_received', {
      paymentMethod: 'bitcoin',
      paykitTotalSats: 1_255,
      merchandiseTotal: { amountMinor: 1_000, currency: 'BTC', exponent: 8 },
      bitcoinPayable: { amountMinor: 1_255, currency: 'SAT', exponent: 0 },
      subtotal: { amountMinor: 1_000, currency: 'BTC', exponent: 8 },
      shipping: { amountMinor: 0, currency: 'BTC', exponent: 8 },
      total: { amountMinor: 1_255, currency: 'BTC', exponent: 8 },
    });
    const actOnOrder = vi.fn(async () => true);
    const { result } = renderHook(() => useMarketplaceOrderAction(order, actOnOrder));

    act(() => {
      result.current.setAction('refund', { transactionId: 'txid-canary-refund' });
    });
    expect(result.current.form.getValues('amount')).toBe('1255');
    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.submit();
    });

    expect(succeeded).toBe(true);
    expect(actOnOrder).toHaveBeenCalledWith(order, 'refund.record_external', {
      amountMinor: 1_255,
      transactionId: 'txid-canary-refund',
    });
  });

  it('still refuses a zero refund when PayPal has refunded nothing', async () => {
    const actOnOrder = vi.fn(async () => true);
    const { result } = renderHook(() => useMarketplaceOrderAction(paypalOrder, actOnOrder));

    act(() => {
      result.current.setAction('refund', { amount: '0', transactionId: 'PAYPALREFUND000' });
    });
    await act(async () => {
      await result.current.submit();
    });

    expect(actOnOrder).not.toHaveBeenCalled();
    expect(result.current.form.getFieldState('amount').error?.message).toBe('Enter a valid refund amount.');
  });
});

describe('useMarketplaceOrderAction USDT refund', () => {
  const hash = `0x${'ab12'.repeat(16)}`;
  const usdtOrder = createUsdtOrderFixture('return_received', {
    refundDestination: {
      address: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
      network: 'arbitrum-one',
      asset: 'USDT',
      source: 'buyer_entered',
      confirmedAt: '2026-10-09T16:00:00.000Z',
    },
  });

  async function record(transactionId: string, amount = '137.00') {
    const actOnOrder = vi.fn(async () => true);
    const { result } = renderHook(() => {
      const value = useMarketplaceOrderAction(usdtOrder, actOnOrder);
      void value.form.formState.errors;
      return value;
    });
    act(() => {
      result.current.setAction('refund', { amount, transactionId });
    });
    await act(async () => {
      await result.current.submit();
    });
    return { actOnOrder, result };
  }

  it('records the Arbitrum transaction hash in order cents, lowercased', async () => {
    const { actOnOrder } = await record(hash.toUpperCase().replace('0X', '0x'));
    expect(actOnOrder).toHaveBeenCalledWith(usdtOrder, 'refund.record_external', {
      amountMinor: 13_700,
      transactionId: hash,
    });
  });

  it.each([
    '',
    'txid-canary-refund',
    `0x${'a'.repeat(63)}`,
    `0x${'g'.repeat(64)}`,
    '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  ])('refuses %j as a USDT refund reference', async (transactionId) => {
    const { actOnOrder, result } = await record(transactionId);
    expect(actOnOrder).not.toHaveBeenCalled();
    expect(result.current.form.formState.errors.transactionId?.message).toBe(
      'Enter the Arbitrum transaction hash (0x followed by 64 characters).',
    );
  });

  it('keeps free-form evidence for every other rail', async () => {
    const bitcoin = createOrderFixture('return_received', { paymentMethod: 'bitcoin' });
    const actOnOrder = vi.fn(async () => true);
    const { result } = renderHook(() => useMarketplaceOrderAction(bitcoin, actOnOrder));
    act(() => {
      result.current.setAction('refund', { amount: '137.00', transactionId: 'txid-canary-refund' });
    });
    await act(async () => {
      await result.current.submit();
    });
    expect(actOnOrder).toHaveBeenCalledWith(bitcoin, 'refund.record_external', {
      amountMinor: 13_700,
      transactionId: 'txid-canary-refund',
    });
  });
});

describe('useMarketplaceOrderAction USDT refund on an order priced in satoshis', () => {
  const hash = `0x${'ab12'.repeat(16)}`;
  const order = createUsdtOrderFixture('return_received', {
    total: { amountMinor: 150_000, currency: 'SAT', exponent: 0 },
    paymentMethod: 'paykit',
    paymentAmountMinor: 41_250_000,
    refundDestination: {
      address: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
      network: 'arbitrum-one',
      asset: 'USDT',
      source: 'buyer_entered',
      confirmedAt: '2026-10-09T16:00:00.000Z',
    },
  });

  async function record(amount: string) {
    const actOnOrder = vi.fn(async () => true);
    const { result } = renderHook(() => {
      const value = useMarketplaceOrderAction(order, actOnOrder);
      void value.form.formState.errors;
      return value;
    });
    act(() => {
      result.current.setAction('refund', { amount, transactionId: hash });
    });
    await act(async () => {
      await result.current.submit();
    });
    return { actOnOrder, result };
  }

  it('starts at the whole amount paid and records it in USDT millionths', async () => {
    const actOnOrder = vi.fn(async () => true);
    const { result } = renderHook(() => useMarketplaceOrderAction(order, actOnOrder));
    act(() => result.current.setAction('refund', { transactionId: hash }));
    expect(result.current.form.getValues('amount')).toBe('41.250000');
    await act(async () => {
      await result.current.submit();
    });
    expect(actOnOrder).toHaveBeenCalledWith(order, 'refund.record_external', {
      amountMinor: 41_250_000,
      transactionId: hash,
    });
  });

  it('accepts six decimals and refuses more than the amount paid', async () => {
    const partial = await record('10.123456');
    expect(partial.actOnOrder).toHaveBeenCalledWith(order, 'refund.record_external', {
      amountMinor: 10_123_456,
      transactionId: hash,
    });
    const over = await record('41.250001');
    expect(over.actOnOrder).not.toHaveBeenCalled();
    expect(over.result.current.form.formState.errors.amount?.message).toBe('Enter a refund up to the USDT received.');
  });
});

describe('useMarketplaceOrderAction USDT refund of another amount than quoted', () => {
  const hash = `0x${'ab12'.repeat(16)}`;
  const received = (paymentAmountMinor: number) =>
    createUsdtOrderFixture('cancelled', {
      paymentAmountMinor,
      refundDestination: {
        address: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
        network: 'arbitrum-one',
        asset: 'USDT',
        source: 'buyer_entered',
        confirmedAt: '2026-10-09T16:00:00.000Z',
      },
    });

  async function record(order: MarketplaceOrder, amount?: string) {
    const actOnOrder = vi.fn(async () => true);
    const { result } = renderHook(() => {
      const value = useMarketplaceOrderAction(order, actOnOrder);
      void value.form.formState.errors;
      return value;
    });
    act(() => {
      result.current.setAction('refund', { transactionId: hash, ...(amount === undefined ? {} : { amount }) });
    });
    const prefilled = result.current.form.getValues('amount');
    await act(async () => {
      await result.current.submit();
    });
    return { actOnOrder, result, prefilled };
  }

  it('starts at what an underpaid transfer carried and refuses the quote', async () => {
    const underpaid = received(136_000_000);
    const whole = await record(underpaid);
    expect(whole.prefilled).toBe('136.00');
    expect(whole.actOnOrder).toHaveBeenCalledWith(underpaid, 'refund.record_external', {
      amountMinor: 13_600,
      transactionId: hash,
    });
    const quote = await record(underpaid, '137.00');
    expect(quote.actOnOrder).not.toHaveBeenCalled();
    expect(quote.result.current.form.formState.errors.amount?.message).toBe('Enter a refund up to the USDT received.');
  });

  it('records the whole of an overpaid transfer, excess included, and no more', async () => {
    const overpaid = received(138_000_000);
    const whole = await record(overpaid);
    expect(whole.prefilled).toBe('138.00');
    expect(whole.actOnOrder).toHaveBeenCalledWith(overpaid, 'refund.record_external', {
      amountMinor: 13_800,
      transactionId: hash,
    });
    const over = await record(overpaid, '138.01');
    expect(over.actOnOrder).not.toHaveBeenCalled();
  });

  it('keeps a return request within the order total', async () => {
    const overpaid = received(138_000_000);
    const { result } = renderHook(() =>
      useMarketplaceOrderAction(
        overpaid,
        vi.fn(async () => true),
      ),
    );
    act(() => result.current.setAction('return'));
    expect(result.current.form.getValues('amount')).toBe('137.00');
  });
});
