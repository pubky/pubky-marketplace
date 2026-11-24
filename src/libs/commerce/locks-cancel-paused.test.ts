import { describe, expect, it } from 'vitest';
import { LOCKS_CANCEL_PAUSED_IN_PROGRESS_COPY, locksCancelPausedMessage } from './locks-cancel-paused';

const FORMAT = { locale: 'en-US', timeZone: 'UTC' } as const;

describe('locksCancelPausedMessage', () => {
  it('states the local hour and minute for an unregistered payment ending on the same day', () => {
    expect(
      locksCancelPausedMessage({
        windowExpiresAt: '2026-11-24T19:55:00.000Z',
        registered: false,
        now: Date.parse('2026-11-24T20:00:00.000Z'),
        ...FORMAT,
      }),
    ).toBe('Cancelling is paused while this payment is being set up. You can cancel it after 8:05 PM.');
  });

  it('adds the short month and day when the available time is on another day', () => {
    expect(
      locksCancelPausedMessage({
        windowExpiresAt: '2026-11-24T23:55:00.000Z',
        registered: false,
        now: Date.parse('2026-11-24T23:58:00.000Z'),
        ...FORMAT,
      }),
    ).toBe('Cancelling is paused while this payment is being set up. You can cancel it after Nov 25, 12:05 AM.');
  });

  it.each([
    ['registered', { windowExpiresAt: '2026-11-24T19:55:00.000Z', registered: true }],
    ['unparseable', { windowExpiresAt: 'not-a-date', registered: false }],
    ['missing', { windowExpiresAt: null, registered: false }],
    ['past', { windowExpiresAt: '2026-11-24T19:55:00.000Z', registered: false }],
  ] as const)('states no exact time when the window is %s', (_label, input) => {
    const now = Date.parse(_label === 'past' ? '2026-11-24T20:06:00.000Z' : '2026-11-24T20:00:00.000Z');
    expect(locksCancelPausedMessage({ ...input, now, ...FORMAT })).toBe(LOCKS_CANCEL_PAUSED_IN_PROGRESS_COPY);
    expect(LOCKS_CANCEL_PAUSED_IN_PROGRESS_COPY).toBe(
      'Cancelling is paused while this payment is still in progress. You can cancel it once the payment has finished or its payment time has ended.',
    );
  });
});
