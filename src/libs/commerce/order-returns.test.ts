import { describe, expect, it } from 'vitest';
import { deliveredCompletionNote, orderReturnClosure } from './order-returns';

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

describe('deliveredCompletionNote', () => {
  it('keeps the return clause off a final sale and names its auto-complete period', () => {
    const finalSale = { acceptsReturns: false, returnWindowDays: null };
    expect(deliveredCompletionNote({ returnPolicy: finalSale, autoCompleteDays: 7 })).toBe(
      'Completes automatically 7 days after delivery.',
    );
    expect(deliveredCompletionNote({ returnPolicy: finalSale, autoCompleteDays: null })).toBe(
      'Completes automatically 14 days after delivery.',
    );
  });

  it('names the auto-complete period and the separate return window when returns are accepted', () => {
    expect(
      deliveredCompletionNote({
        returnPolicy: { acceptsReturns: true, returnWindowDays: 30 },
        autoCompleteDays: 14,
      }),
    ).toBe(
      'Completes automatically 14 days after delivery unless a return is requested. A return can be requested within 30 days of delivery, even after the order completes.',
    );
  });

  it('only says a return outlasts completion when the window is longer than the auto-complete period', () => {
    expect(
      deliveredCompletionNote({
        returnPolicy: { acceptsReturns: true, returnWindowDays: 7 },
        autoCompleteDays: 14,
      }),
    ).toBe(
      'Completes automatically 14 days after delivery unless a return is requested. A return can be requested within 7 days of delivery.',
    );
    expect(
      deliveredCompletionNote({
        returnPolicy: { acceptsReturns: true, returnWindowDays: 14 },
        autoCompleteDays: 14,
      }),
    ).toBe(
      'Completes automatically 14 days after delivery unless a return is requested. A return can be requested within 14 days of delivery.',
    );
    expect(
      deliveredCompletionNote({
        returnPolicy: { acceptsReturns: true, returnWindowDays: 2 },
        autoCompleteDays: 1,
      }),
    ).toBe(
      'Completes automatically 1 day after delivery unless a return is requested. A return can be requested within 2 days of delivery, even after the order completes.',
    );
  });

  it('falls back to the default auto-complete period and leaves the window out when none was frozen', () => {
    const note = 'Completes automatically 14 days after delivery unless a return is requested.';
    expect(deliveredCompletionNote({ returnPolicy: null })).toBe(note);
    expect(deliveredCompletionNote({})).toBe(note);
    expect(deliveredCompletionNote({ returnPolicy: { acceptsReturns: true, returnWindowDays: null } })).toBe(note);
  });
});
