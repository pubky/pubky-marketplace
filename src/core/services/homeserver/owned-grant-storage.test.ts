import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installWebLocks, removeWebLocks } from '@/test-utils/web-locks';
import {
  forgetOwnedGrant,
  pendingOwnedGrants,
  rememberOwnedGrant,
  withAbandonedOwnedGrant,
} from './owned-grant-storage';

beforeEach(() => {
  localStorage.clear();
  installWebLocks();
});
afterEach(removeWebLocks);

it('does not delete a key whose approval committed after the cleanup scan', async () => {
  rememberOwnedGrant('key', 'approved-key');
  const [scanned] = pendingOwnedGrants();
  // Another tab commits its SDK record, then removes the pending key marker.
  forgetOwnedGrant('key', 'approved-key');
  const remove = vi.fn();
  await withAbandonedOwnedGrant(scanned, remove);
  expect(remove).not.toHaveBeenCalled();
});

it('does not delete a key whose ownership marker was renewed after the scan', async () => {
  rememberOwnedGrant('key', 'active-key');
  const [scanned] = pendingOwnedGrants();
  rememberOwnedGrant('key', 'active-key', Date.now() + 60_000);
  const remove = vi.fn();
  await withAbandonedOwnedGrant(scanned, remove);
  expect(remove).not.toHaveBeenCalled();
  forgetOwnedGrant('key', 'active-key');
});
