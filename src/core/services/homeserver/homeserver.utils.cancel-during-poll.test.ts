import type { Session } from '@synonymdev/pubky';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_FLOW_CANCELED_ERROR_NAME } from './error.utils';
import { createCancelableAuthApproval } from './homeserver.utils';

vi.mock('@/libs/logger/logger', () => ({
  Logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('createCancelableAuthApproval cancel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('frees the flow only once a poll that is still running settles', async () => {
    let settlePoll: (value: Session | undefined) => void = () => {};
    const flow = {
      tryPollOnce: vi.fn(() => new Promise<Session | undefined>((resolve) => (settlePoll = resolve))),
      free: vi.fn(),
    };
    const approval = createCancelableAuthApproval(flow);
    const outcome = approval.awaitApproval.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(0);
    expect(flow.tryPollOnce).toHaveBeenCalledOnce();

    approval.cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(flow.free).not.toHaveBeenCalled();

    settlePoll(undefined);
    await vi.advanceTimersByTimeAsync(100);
    await expect(outcome).resolves.toMatchObject({ name: AUTH_FLOW_CANCELED_ERROR_NAME });
    expect(flow.free).toHaveBeenCalledOnce();
    expect(flow.tryPollOnce).toHaveBeenCalledOnce();
  });

  it('frees the flow at once when cancelled between polls', async () => {
    const flow = { tryPollOnce: vi.fn().mockResolvedValue(undefined), free: vi.fn() };
    const approval = createCancelableAuthApproval(flow);
    const outcome = approval.awaitApproval.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(0);
    expect(flow.tryPollOnce).toHaveBeenCalledOnce();

    approval.cancel();
    expect(flow.free).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(100);
    await expect(outcome).resolves.toMatchObject({ name: AUTH_FLOW_CANCELED_ERROR_NAME });
    expect(flow.free).toHaveBeenCalledOnce();
  });

  it('frees the flow once a running poll fails after a cancel', async () => {
    let failPoll: (error: Error) => void = () => {};
    const flow = {
      tryPollOnce: vi.fn(() => new Promise<Session | undefined>((_resolve, reject) => (failPoll = reject))),
      free: vi.fn(),
    };
    const approval = createCancelableAuthApproval(flow);
    const outcome = approval.awaitApproval.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(0);
    approval.cancel();
    expect(flow.free).not.toHaveBeenCalled();

    failPoll(new TypeError('Failed to fetch'));
    await expect(outcome).resolves.toMatchObject({ name: AUTH_FLOW_CANCELED_ERROR_NAME });
    expect(flow.free).toHaveBeenCalledOnce();
  });
});
