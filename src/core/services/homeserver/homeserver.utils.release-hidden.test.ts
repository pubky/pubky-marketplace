import type { Session } from '@synonymdev/pubky';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthErrorCode, TimeoutErrorCode } from '@/libs/error/error.codes';
import { asOpaque } from '@/test-utils/type-assertions';
import { createCancelableAuthApproval } from './homeserver.utils';

vi.mock('@/libs/logger/logger', () => ({
  Logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const session = asOpaque<Session>({ info: { publicKey: { z32: () => 'pubky-test' } } });

const pendingFlow = () => ({ tryPollOnce: vi.fn().mockResolvedValue(undefined), free: vi.fn() });

describe('createCancelableAuthApproval with releaseWhileHidden', () => {
  let visibility: ReturnType<typeof vi.spyOn>;

  const hide = () => {
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  };
  const show = () => {
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  });

  afterEach(() => {
    visibility.mockRestore();
    vi.useRealTimers();
  });

  it('frees the flow while hidden and collects the approval on a resumed flow once visible', async () => {
    const live = pendingFlow();
    const resumed = { tryPollOnce: vi.fn().mockResolvedValue(session), free: vi.fn() };
    const resume = vi.fn().mockResolvedValue(resumed);
    const approval = createCancelableAuthApproval(live, { resume, releaseWhileHidden: true });

    await vi.advanceTimersByTimeAsync(250);
    expect(live.tryPollOnce).toHaveBeenCalled();
    hide();
    await vi.advanceTimersByTimeAsync(100);
    const polls = live.tryPollOnce.mock.calls.length;
    expect(live.free).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(live.tryPollOnce).toHaveBeenCalledTimes(polls);
    expect(resume).not.toHaveBeenCalled();

    show();
    await expect(approval.awaitApproval).resolves.toBe(session);
    expect(resume).toHaveBeenCalledOnce();
    expect(live.free).toHaveBeenCalledOnce();
    expect(resumed.free).toHaveBeenCalledOnce();
  });

  it('settles at once when cancelled while parked, without resuming', async () => {
    visibility.mockReturnValue('hidden');
    const live = pendingFlow();
    const resume = vi.fn();
    const approval = createCancelableAuthApproval(live, { resume, releaseWhileHidden: true });
    const rejection = expect(approval.awaitApproval).rejects.toMatchObject({ name: 'AuthFlowCanceled' });

    await vi.advanceTimersByTimeAsync(10_000);
    approval.cancel();
    await vi.advanceTimersByTimeAsync(0);

    await rejection;
    expect(live.tryPollOnce).not.toHaveBeenCalled();
    expect(live.free).toHaveBeenCalledOnce();
    expect(resume).not.toHaveBeenCalled();
  });

  it('times out without resuming once the relay no longer holds the approval', async () => {
    const live = pendingFlow();
    const resume = vi.fn();
    const approval = createCancelableAuthApproval(live, { resume, releaseWhileHidden: true });
    const rejection = expect(approval.awaitApproval).rejects.toMatchObject({
      code: TimeoutErrorCode.REQUEST_TIMEOUT,
      operation: 'awaitApproval',
    });

    await vi.advanceTimersByTimeAsync(0);
    hide();
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
    show();
    await vi.advanceTimersByTimeAsync(0);

    await rejection;
    expect(resume).not.toHaveBeenCalled();
  });

  it('rejects with SESSION_EXPIRED when the channel cannot be resumed once visible', async () => {
    const live = pendingFlow();
    const resume = vi.fn().mockRejectedValue(Object.assign(new Error('key gone'), { name: 'ClientStateError' }));
    const approval = createCancelableAuthApproval(live, { resume, releaseWhileHidden: true });
    const rejection = expect(approval.awaitApproval).rejects.toMatchObject({
      code: AuthErrorCode.SESSION_EXPIRED,
      context: { resumeError: 'key gone' },
    });

    await vi.advanceTimersByTimeAsync(0);
    hide();
    await vi.advanceTimersByTimeAsync(100);
    show();
    await vi.advanceTimersByTimeAsync(0);

    await rejection;
    expect(resume).toHaveBeenCalledOnce();
  });

  it('frees a resumed flow that arrives after cancellation without polling it', async () => {
    const live = pendingFlow();
    const resumed = pendingFlow();
    let finishResume!: (flow: typeof resumed) => void;
    const resume = vi.fn(
      () =>
        new Promise<typeof resumed>((resolve) => {
          finishResume = resolve;
        }),
    );
    const approval = createCancelableAuthApproval(live, { resume, releaseWhileHidden: true });
    const rejection = expect(approval.awaitApproval).rejects.toMatchObject({ name: 'AuthFlowCanceled' });

    await vi.advanceTimersByTimeAsync(0);
    hide();
    await vi.advanceTimersByTimeAsync(100);
    show();
    await vi.advanceTimersByTimeAsync(0);
    expect(resume).toHaveBeenCalledOnce();

    approval.cancel();
    finishResume(resumed);
    await rejection;
    expect(resumed.tryPollOnce).not.toHaveBeenCalled();
    expect(resumed.free).toHaveBeenCalledOnce();
    expect(live.free).toHaveBeenCalledOnce();
  });

  it('keeps polling the same flow in a hidden page when the option is off', async () => {
    const live = pendingFlow();
    const resume = vi.fn();
    const approval = createCancelableAuthApproval(live, { resume });

    await vi.advanceTimersByTimeAsync(0);
    hide();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(live.free).not.toHaveBeenCalled();
    expect(live.tryPollOnce.mock.calls.length).toBeGreaterThan(5);

    live.tryPollOnce.mockResolvedValue(session);
    await vi.advanceTimersByTimeAsync(100);
    await expect(approval.awaitApproval).resolves.toBe(session);
    expect(resume).not.toHaveBeenCalled();
  });
});
