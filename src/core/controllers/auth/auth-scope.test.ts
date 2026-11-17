import { describe, expect, it } from 'vitest';
import { captureAuthScope, endAuthScope } from './auth-scope';

describe('auth scope', () => {
  it('aborts what was captured before it ended and hands later work a live scope', () => {
    const before = captureAuthScope();
    expect(before.aborted).toBe(false);
    expect(captureAuthScope()).toBe(before);

    endAuthScope();

    expect(before.aborted).toBe(true);
    const after = captureAuthScope();
    expect(after).not.toBe(before);
    expect(after.aborted).toBe(false);
  });

  it('lets abort listeners capture the next scope, not the one ending', () => {
    const ending = captureAuthScope();
    const seenInListener: AbortSignal[] = [];
    ending.addEventListener('abort', () => seenInListener.push(captureAuthScope()));

    endAuthScope();

    expect(seenInListener).toHaveLength(1);
    expect(seenInListener[0]).not.toBe(ending);
    expect(seenInListener[0].aborted).toBe(false);
  });
});
