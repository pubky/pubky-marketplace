import { describe, expect, it } from 'vitest';
import { orderReturnClosure } from './order-returns';

const delivered = { deliveredAt: '2026-10-01T12:00:00.000Z' };
const day = (n: number) => Date.parse('2026-10-01T12:00:00.000Z') + n * 86_400_000;

describe('orderReturnClosure', () => {
  it('takes a return when no policy was frozen', () => {
    expect(orderReturnClosure({ returnPolicy: null, shipment: delivered }, day(400))).toBeNull();
  });

  it('closes a final sale', () => {
    expect(
      orderReturnClosure(
        { returnPolicy: { acceptsReturns: false, returnWindowDays: null }, shipment: delivered },
        day(1),
      ),
    ).toBe('final_sale');
  });

  it('closes a day after the window, counted from delivery, so a fast device clock never hides a valid return', () => {
    const order = { returnPolicy: { acceptsReturns: true, returnWindowDays: 14 }, shipment: delivered };
    expect(orderReturnClosure(order, day(15))).toBeNull();
    expect(orderReturnClosure(order, day(15) + 1)).toBe('window_closed');
  });

  it('leaves the window open when delivery or the clock is unknown', () => {
    const policy = { acceptsReturns: true, returnWindowDays: 14 };
    expect(orderReturnClosure({ returnPolicy: policy, shipment: null }, day(30))).toBeNull();
    expect(orderReturnClosure({ returnPolicy: policy, shipment: delivered }, null)).toBeNull();
  });
});
