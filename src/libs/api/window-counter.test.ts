import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowCounter } from './window-counter';

const LIMIT = 3;
const WINDOW_MS = 60_000;
const MAX_KEYS = 100;

function fill(counter: WindowCounter, keys: number) {
  for (let i = 0; i < keys; i += 1) counter.consume(`key:${i}`, 1);
}

describe('WindowCounter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('admits a key up to its limit within one window', () => {
    const counter = new WindowCounter(LIMIT, WINDOW_MS, MAX_KEYS);
    for (let i = 0; i < LIMIT; i += 1) expect(counter.consume('a', 1).ok).toBe(true);
  });

  it('refuses a key past its limit and reports a retry of at least one second', () => {
    const counter = new WindowCounter(LIMIT, WINDOW_MS, MAX_KEYS);
    for (let i = 0; i < LIMIT; i += 1) counter.consume('a', 1);

    vi.advanceTimersByTime(WINDOW_MS - 1);
    const refused = counter.consume('a', 1);

    expect(refused).toEqual({ ok: false, retryAfterSeconds: 1 });
  });

  it('counts the amount consumed, not the number of calls', () => {
    const counter = new WindowCounter(100, WINDOW_MS, MAX_KEYS);
    expect(counter.consume('a', 100).ok).toBe(true);
    expect(counter.consume('a', 1).ok).toBe(false);
  });

  it('keeps keys independent', () => {
    const counter = new WindowCounter(LIMIT, WINDOW_MS, MAX_KEYS);
    for (let i = 0; i < LIMIT; i += 1) counter.consume('a', 1);
    expect(counter.consume('b', 1).ok).toBe(true);
  });

  it('opens a fresh window once the window elapses', () => {
    const counter = new WindowCounter(LIMIT, WINDOW_MS, MAX_KEYS);
    for (let i = 0; i < LIMIT; i += 1) counter.consume('a', 1);
    expect(counter.consume('a', 1).ok).toBe(false);

    vi.advanceTimersByTime(WINDOW_MS);

    expect(counter.consume('a', 1).ok).toBe(true);
  });

  describe('peek', () => {
    it('reports a spent key without consuming from it', () => {
      const counter = new WindowCounter(LIMIT, WINDOW_MS, MAX_KEYS);
      for (let i = 0; i < LIMIT; i += 1) counter.consume('a', 1);

      const refused = counter.peek('a');

      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.retryAfterSeconds).toBe(WINDOW_MS / 1000);
    });

    it('does not open a window, so peeking never takes a slot in the key table', () => {
      const counter = new WindowCounter(LIMIT, WINDOW_MS, 1);
      expect(counter.peek('a').ok).toBe(true);
      expect(counter.consume('b', 1).ok).toBe(true);
    });
  });

  describe('key table bound', () => {
    it('refuses a new key once the key table is full of live windows', () => {
      const counter = new WindowCounter(LIMIT, WINDOW_MS, MAX_KEYS);
      fill(counter, MAX_KEYS);

      const refused = counter.consume('newcomer', 1);

      expect(refused).toEqual({ ok: false, retryAfterSeconds: WINDOW_MS / 1000 });
    });

    it('keeps the live window of a spent key when the table fills', () => {
      const counter = new WindowCounter(LIMIT, WINDOW_MS, 3);
      for (let i = 0; i < LIMIT; i += 1) counter.consume('spent', 1);
      fill(counter, 5);

      expect(counter.consume('spent', 1).ok).toBe(false);
    });

    it('keeps serving keys already in a full table', () => {
      const counter = new WindowCounter(LIMIT, WINDOW_MS, 2);
      fill(counter, 2);
      expect(counter.consume('key:0', 1).ok).toBe(true);
    });

    it('evicts expired windows to make room for a new key', () => {
      const counter = new WindowCounter(LIMIT, WINDOW_MS, 2);
      fill(counter, 2);
      expect(counter.consume('newcomer', 1).ok).toBe(false);

      vi.advanceTimersByTime(WINDOW_MS);

      expect(counter.consume('newcomer', 1).ok).toBe(true);
      expect(counter.consume('second-newcomer', 1).ok).toBe(true);
    });
  });

  it('forgets every window when cleared', () => {
    const counter = new WindowCounter(LIMIT, WINDOW_MS, 1);
    for (let i = 0; i < LIMIT; i += 1) counter.consume('a', 1);

    counter.clear();

    expect(counter.consume('b', 1).ok).toBe(true);
  });
});
