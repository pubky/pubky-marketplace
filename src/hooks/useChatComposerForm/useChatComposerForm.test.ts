import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatComposerForm } from './useChatComposerForm';

const PEER = 's'.repeat(52);

const mocks = vi.hoisted(() => ({
  commitSendMessage: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/controllers/chat/chat', () => ({
  ChatController: { commitSendMessage: mocks.commitSendMessage },
}));
vi.mock('@/molecules/Toaster/toast', () => ({ toast: mocks.toast }));
vi.mock('@/libs/logger/logger', () => ({ Logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

async function submit(body: string) {
  const { result } = renderHook(() => useChatComposerForm(PEER));
  act(() => result.current.form.setValue('body', body));
  let sent: boolean | undefined;
  await act(async () => {
    sent = await result.current.submit();
  });
  return { sent, body: result.current.form.getValues('body') };
}

describe('useChatComposerForm', () => {
  beforeEach(() => {
    mocks.commitSendMessage.mockReset();
    mocks.toast.mockReset();
  });

  it('shows no error when sending is cancelled by a sign-out', async () => {
    mocks.commitSendMessage.mockRejectedValue(new DOMException('This operation was aborted', 'AbortError'));

    const outcome = await submit('Is this still available?');

    expect(mocks.commitSendMessage).toHaveBeenCalledOnce();
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(outcome.sent).toBe(false);
  });

  it('still tells the user when a message could not be queued', async () => {
    mocks.commitSendMessage.mockRejectedValue(new Error('storage full'));

    const outcome = await submit('Is this still available?');

    expect(mocks.toast).toHaveBeenCalledWith({
      variant: 'error',
      title: 'Could not send',
      description: 'Try again in a moment.',
    });
    expect(outcome).toEqual({ sent: false, body: 'Is this still available?' });
  });
});
