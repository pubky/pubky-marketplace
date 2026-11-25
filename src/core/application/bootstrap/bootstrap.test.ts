import { afterEach, expect, it, vi } from 'vitest';
import { BootstrapApplication } from '@/application/bootstrap/bootstrap';
import { UserApplication } from '@/application/user/user';
import { HomeserverService } from '@/services/homeserver/homeserver';
import * as nexus from '@/services/nexus/nexus.utils';

const pubky = '8kkppkmiubfq4pxn6f73nqrhhhgkb5xyfprntc9si3np9ydbotto';

afterEach(() => {
  BootstrapApplication.cancelModerationFollow();
  vi.restoreAllMocks();
});

it('starts the optional moderation follow without fetching a social feed, public preferences, or a notification cursor', async () => {
  const follow = vi.spyOn(UserApplication, 'ensureModerationFollow').mockResolvedValue(undefined);
  const query = vi.spyOn(nexus, 'queryNexus');
  const list = vi.spyOn(HomeserverService, 'list');
  const read = vi.spyOn(HomeserverService, 'getJsonIfFound');
  const write = vi.spyOn(HomeserverService, 'request');

  await BootstrapApplication.initialize({ pubky });
  expect(follow).toHaveBeenCalledWith(expect.objectContaining({ follower: pubky, signal: expect.any(AbortSignal) }));
  expect(query).not.toHaveBeenCalled();
  expect(list).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});

it('cancels the previous follow on a new session and never starts one for an ended scope', async () => {
  const follow = vi
    .spyOn(UserApplication, 'ensureModerationFollow')
    .mockImplementation(
      ({ signal }) =>
        new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true })),
    );
  await BootstrapApplication.initialize({ pubky });
  const first = follow.mock.calls[0]![0].signal!;
  await BootstrapApplication.initialize({ pubky, signal: AbortSignal.abort() });
  expect(first.aborted).toBe(true);
  expect(follow).toHaveBeenCalledTimes(1);
});

it('stops the pending follow when the sign-in scope ends', async () => {
  const follow = vi
    .spyOn(UserApplication, 'ensureModerationFollow')
    .mockImplementation(
      ({ signal }) =>
        new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true })),
    );
  const scope = new AbortController();
  await BootstrapApplication.initialize({ pubky, signal: scope.signal });
  scope.abort();
  expect(follow.mock.calls[0]![0].signal!.aborted).toBe(true);
});
