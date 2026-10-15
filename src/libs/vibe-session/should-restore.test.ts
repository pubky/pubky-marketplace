import { afterEach, describe, expect, it } from 'vitest';
import { shouldAttemptSessionRestore } from './should-restore';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('shouldAttemptSessionRestore', () => {
  it('starts migration when persisted cookie metadata is present', () => {
    expect(shouldAttemptSessionRestore('legacy-export')).toBe(true);
  });
  it('does not start cookie cleanup without persisted metadata, even when a retired handoff fragment is present', () => {
    expect(shouldAttemptSessionRestore(null)).toBe(false);
    window.history.replaceState(null, '', '/#s=legacy-cookie');
    expect(shouldAttemptSessionRestore(null)).toBe(false);
    expect(shouldAttemptSessionRestore(undefined)).toBe(false);
  });
});
