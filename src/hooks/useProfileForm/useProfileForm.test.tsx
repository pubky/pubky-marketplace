import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthController } from '@/controllers/auth/auth';
import { ProfileController } from '@/controllers/profile/profile';
import { AppError } from '@/libs/error/error';
import { AuthErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import type { NexusUserDetails } from '@/services/nexus/nexus.types';
import { useAuthStore } from '@/stores/auth/auth.store';
import { mockSession } from '@/test-utils/pubky';
import { useProfileForm } from './useProfileForm';
import { WRITE_PATH_NOT_ALLOWED_MESSAGE } from './useProfileForm.types';

const { mockToast, mockPush } = vi.hoisted(() => ({ mockToast: vi.fn(), mockPush: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn() }),
}));

vi.mock('@/controllers/auth/auth', () => ({
  AuthController: { bootstrapWithDelay: vi.fn() },
}));

vi.mock('@/controllers/file/file', () => ({
  FileController: { commitCreate: vi.fn(), getAvatarUrl: vi.fn() },
}));

vi.mock('@/controllers/profile/profile', () => ({
  ProfileController: { commitCreate: vi.fn(), commitUpdate: vi.fn(), readProfileSeed: vi.fn(async () => null) },
}));

vi.mock('@/molecules/Toaster/toast', () => ({
  toast: mockToast,
}));

vi.mock('@/stores/localFiles/localFiles.store', () => ({
  useLocalFilesStore: { getState: () => ({ setProfile: vi.fn() }) },
}));

const pubky = 'test-pubky';
beforeEach(() => {
  useAuthStore.setState({ session: mockSession(), currentUserPubky: pubky, isLoggingOut: false });
});

const unsafeLink = { label: 'Website', url: 'javascript:alert(1)' };

describe('useProfileForm profile link safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks an unsafe link from the create-profile submission path', async () => {
    const { result } = renderHook(() => useProfileForm({ mode: 'create', pubky }));

    act(() => {
      result.current.handlers.setName('Valid User');
      result.current.handlers.setLinks([unsafeLink]);
      result.current.handlers.validateLinkUrl(unsafeLink.url, 0);
    });

    expect(result.current.errors.linkUrlErrors[0]).toBe('Invalid URL');

    await act(async () => {
      await result.current.handlers.handleSubmit();
    });

    expect(ProfileController.commitCreate).not.toHaveBeenCalled();
  });

  it('blocks an unsafe legacy link from the edit-profile submission path', async () => {
    const userDetails: NexusUserDetails = {
      id: pubky,
      name: 'Valid User',
      bio: '',
      links: [{ title: unsafeLink.label, url: unsafeLink.url }],
      status: null,
      image: null,
      indexed_at: 1,
    };
    const { result } = renderHook(() => useProfileForm({ mode: 'edit', pubky, userDetails }));

    await waitFor(() => expect(result.current.state.isLoading).toBe(false));

    act(() => {
      result.current.handlers.validateLinkUrl(unsafeLink.url, 0);
    });

    expect(result.current.errors.linkUrlErrors[0]).toBe('Invalid URL');

    await act(async () => {
      await result.current.handlers.handleSubmit();
    });

    expect(ProfileController.commitUpdate).not.toHaveBeenCalled();
  });
});

describe('useProfileForm create mode prefill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ProfileController.readProfileSeed).mockResolvedValue(null);
  });

  const renderCreate = () => renderHook(() => useProfileForm({ mode: 'create', pubky }));

  it('does not invent a name when the account has no profile', async () => {
    const { result } = renderCreate();

    await waitFor(() => expect(ProfileController.readProfileSeed).toHaveBeenCalledWith({ pubky }));
    expect(result.current.state.name).toBe('');
    expect(result.current.isSubmitDisabled).toBe(true);
  });

  it('prefills name, bio and links from an existing profile', async () => {
    vi.mocked(ProfileController.readProfileSeed).mockResolvedValue({
      name: 'Dusty Dolphin',
      bio: 'Sells coffee',
      links: [{ title: 'Website', url: 'https://example.com' }],
    });
    const { result } = renderCreate();

    await waitFor(() => expect(result.current.state.name).toBe('Dusty Dolphin'));
    expect(result.current.state.bio).toBe('Sells coffee');
    expect(result.current.state.links).toEqual([{ label: 'WEBSITE', url: 'https://example.com' }]);
  });

  it('never overwrites a name typed before the profile arrives', async () => {
    let resolveSeed!: (seed: { name: string; bio: string; links: [] }) => void;
    vi.mocked(ProfileController.readProfileSeed).mockReturnValue(
      new Promise((resolve) => {
        resolveSeed = resolve;
      }),
    );
    const { result } = renderCreate();
    act(() => result.current.handlers.setName('Typed Name'));

    await act(async () => resolveSeed({ name: 'Seed Name', bio: 'Seed bio', links: [] }));

    expect(result.current.state.name).toBe('Typed Name');
    expect(result.current.state.bio).toBe('Seed bio');
  });

  it('edit mode never reads a prefill', () => {
    renderHook(() =>
      useProfileForm({
        mode: 'edit',
        pubky,
        userDetails: { id: pubky, name: 'A', bio: '', links: [], status: null, image: null, indexed_at: 1 },
      }),
    );

    expect(ProfileController.readProfileSeed).not.toHaveBeenCalled();
  });

  it('names the homeserver account restriction when the profile write is refused by path', async () => {
    vi.mocked(ProfileController.commitCreate).mockRejectedValue(
      new AppError({
        category: ErrorCategory.Auth,
        code: AuthErrorCode.FORBIDDEN,
        message: 'Request failed: Server responded with an error: 403 Forbidden - Write to this path is not allowed',
        service: ErrorService.Homeserver,
        operation: 'request',
      }),
    );
    const { result } = renderCreate();
    act(() => result.current.handlers.setName('Valid User'));

    await act(async () => {
      await result.current.handlers.handleSubmit();
    });

    expect(mockToast).toHaveBeenCalledWith({ variant: 'error', description: WRITE_PATH_NOT_ALLOWED_MESSAGE });
    expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ description: 'Could not save profile' }));
  });

  it('keeps the generic copy for other homeserver 403s', async () => {
    vi.mocked(ProfileController.commitCreate).mockRejectedValue(
      new AppError({
        category: ErrorCategory.Auth,
        code: AuthErrorCode.FORBIDDEN,
        message:
          'Request failed: Server responded with an error: 403 Forbidden - Session does not have write access to path',
        service: ErrorService.Homeserver,
        operation: 'request',
      }),
    );
    const { result } = renderCreate();
    act(() => result.current.handlers.setName('Valid User'));

    await act(async () => {
      await result.current.handlers.handleSubmit();
    });

    expect(mockToast).toHaveBeenCalledWith({ variant: 'error', description: 'Could not save profile' });
  });
});

describe('existing-account profile completion authority', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ProfileController.commitCreate).mockResolvedValue();
    vi.mocked(AuthController.bootstrapWithDelay).mockResolvedValue();
  });
  const renderForm = () => {
    const form = renderHook(() => useProfileForm({ mode: 'create', pubky }));
    act(() => form.result.current.handlers.setName('Fictional Seller'));
    return form;
  };
  it('never submits a profile without a live session', async () => {
    useAuthStore.setState({ session: null });
    const { result } = renderForm();
    await act(async () => result.current.handlers.handleSubmit());
    expect(ProfileController.commitCreate).not.toHaveBeenCalled();
    expect(AuthController.bootstrapWithDelay).not.toHaveBeenCalled();
  });
  it('awaits guarded bootstrap and leaves all completion navigation to RouteGuard', async () => {
    let finish!: () => void;
    vi.mocked(AuthController.bootstrapWithDelay).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { result } = renderForm();
    let submit!: Promise<void>;
    act(() => {
      submit = result.current.handlers.handleSubmit();
    });
    await waitFor(() => expect(AuthController.bootstrapWithDelay).toHaveBeenCalledTimes(1));
    expect(result.current.state.isSaving).toBe(true);
    expect(mockPush).not.toHaveBeenCalled();
    await act(async () => {
      finish();
      await submit;
    });
    expect(result.current.state.isSaving).toBe(false);
    expect(mockPush).not.toHaveBeenCalled();
  });
  it.each(['logout', 'account switch'])(
    'does not bootstrap a replacement identity after %s during the write',
    async (change) => {
      let finish!: () => void;
      vi.mocked(ProfileController.commitCreate).mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const { result } = renderForm();
      let submit!: Promise<void>;
      act(() => {
        submit = result.current.handlers.handleSubmit();
      });
      await waitFor(() => expect(ProfileController.commitCreate).toHaveBeenCalled());
      useAuthStore.setState(
        change === 'logout' ? { isLoggingOut: true } : { session: mockSession(), currentUserPubky: 'replacement' },
      );
      await act(async () => {
        finish();
        await submit;
      });
      expect(AuthController.bootstrapWithDelay).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    },
  );
  it('keeps edit-mode navigation to the own profile', async () => {
    const { result } = renderHook(() =>
      useProfileForm({
        mode: 'edit',
        pubky,
        userDetails: {
          id: pubky,
          name: 'Fictional Seller',
          bio: '',
          links: [],
          status: null,
          image: null,
          indexed_at: 1,
        },
      }),
    );
    await act(async () => result.current.handlers.handleSubmit());
    expect(ProfileController.commitUpdate).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledExactlyOnceWith('/profile');
  });
});
