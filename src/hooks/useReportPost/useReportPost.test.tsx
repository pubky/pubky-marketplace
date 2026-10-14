import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpMethod, JSON_HEADERS } from '@/libs/http/http.types';
import { REPORT_ISSUE_TYPES, REPORT_REASON_MAX_LENGTH } from '@/pipes/report/report.constants';
import { setBasePath } from '@/test-utils/base-path';
import { useReportPost } from './useReportPost';
import { REPORT_API_ENDPOINT, REPORT_POST_STEPS } from './useReportPost.constants';

const publicPath = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock('@/libs/runtime-config/runtime-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/runtime-config/runtime-config')>();
  return { ...actual, getShopPublicPathOverride: () => publicPath.value };
});

// Mock fetch
global.fetch = vi.fn();

const TEST_USER_PUBKY = 'test-user-123';
const TEST_USER_NAME = 'Test User';
const TEST_POST_ID = 'author-pubky-456:post-id-789';
const TEST_POST_URL = 'https://example.com/post/author-pubky-456/post-id-789';
const POST_TARGET = { kind: 'post', postId: TEST_POST_ID } as const;
const TEST_SELLER_PUBKY = 'o1gg96ewuojmopcjbz8895478wdtxtzzuxnfjjz8o8e77csa1ngo';
const TEST_LISTING_ID = 'boots_01';
const LISTING_TARGET = { kind: 'listing', sellerPubky: TEST_SELLER_PUBKY, listingId: TEST_LISTING_ID } as const;

// Mock window.location
Object.defineProperty(window, 'location', {
  value: {
    origin: 'https://example.com',
  },
  writable: true,
});

// Mock useCurrentUserProfile hook
const mockUseCurrentUserProfile = vi.fn();
vi.mock('@/hooks/useCurrentUserProfile/useCurrentUserProfile', () => ({
  useCurrentUserProfile: () => mockUseCurrentUserProfile(),
}));

// Mock parseCompositeId
vi.mock('@/models/models.utils', () => ({
  parseCompositeId: (id: string) => {
    const [pubky, postId] = id.split(':');
    return { pubky, id: postId };
  },
}));

// Mock toast helpers
const mockToast = vi.fn();
vi.mock('@/molecules/Toaster/use-toast', () => {
  return {
    toast: (params: { title?: string; description: string; variant?: string }) => mockToast(params),
  };
});

// Mock Logger
vi.mock('@/libs/logger/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/logger/logger')>();
  return {
    ...actual,
    Logger: {
      error: vi.fn(),
    },
  };
});

describe('useReportPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: authenticated user with profile loaded
    mockUseCurrentUserProfile.mockReturnValue({
      currentUserPubky: TEST_USER_PUBKY,
      userDetails: { name: TEST_USER_NAME },
    });
    // Default successful fetch response
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);
  });

  describe('Initial State', () => {
    it('should return initial state with issue selection step', () => {
      const { result } = renderHook(() => useReportPost(POST_TARGET));

      expect(result.current.step).toBe(REPORT_POST_STEPS.ISSUE_SELECTION);
      expect(result.current.selectedIssueType).toBeNull();
      expect(result.current.reason).toBe('');
      expect(result.current.isSubmitting).toBe(false);
      expect(result.current.isSuccess).toBe(false);
      expect(result.current.hasContent).toBe(false);
    });
  });

  describe('postUrl construction', () => {
    it('should construct postUrl correctly from postId', async () => {
      const { result } = renderHook(() => useReportPost(POST_TARGET));

      act(() => {
        result.current.selectIssueType(REPORT_ISSUE_TYPES.PERSONAL_INFO);
      });

      act(() => {
        const event = {
          target: { value: 'Test reason' },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        result.current.handleReasonChange(event);
      });

      await act(async () => {
        await result.current.submit();
      });

      expect(global.fetch).toHaveBeenCalledWith(
        REPORT_API_ENDPOINT,
        expect.objectContaining({
          body: expect.stringContaining(TEST_POST_URL),
        }),
      );
    });
  });

  describe('when the App frames the Shop', () => {
    it('reports the App /shop URL of a listing and a post, not the /shop-embed iframe path', async () => {
      setBasePath('/shop-embed');
      publicPath.value = '/shop';
      try {
        for (const target of [LISTING_TARGET, POST_TARGET]) {
          vi.mocked(global.fetch).mockClear();
          const { result } = renderHook(() => useReportPost(target));
          act(() => {
            result.current.selectIssueType(REPORT_ISSUE_TYPES.PERSONAL_INFO);
          });
          act(() => {
            result.current.handleReasonChange({
              target: { value: 'Test reason' },
            } as React.ChangeEvent<HTMLTextAreaElement>);
          });
          await act(async () => {
            await result.current.submit();
          });

          const [, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
          const { postUrl } = JSON.parse(init.body as string) as { postUrl: string };
          expect(postUrl).toBe(
            target.kind === 'listing'
              ? `https://example.com/shop/marketplace/listing/${TEST_SELLER_PUBKY}/${TEST_LISTING_ID}`
              : 'https://example.com/shop/post/author-pubky-456/post-id-789',
          );
        }
      } finally {
        setBasePath('');
        publicPath.value = undefined;
      }
    });
  });

  describe('listing target', () => {
    async function submitListingReport(target: typeof LISTING_TARGET = LISTING_TARGET) {
      const { result } = renderHook(() => useReportPost(target));
      act(() => {
        result.current.selectIssueType(REPORT_ISSUE_TYPES.ILLEGAL_SALES);
      });
      act(() => {
        result.current.handleReasonChange({
          target: { value: 'Sells counterfeit goods' },
        } as React.ChangeEvent<HTMLTextAreaElement>);
      });
      await act(async () => {
        await result.current.submit();
      });
      return result;
    }

    it('posts the listing URL, listing id and seller pubky to the report route', async () => {
      const result = await submitListingReport();

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [endpoint, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(endpoint).toBe(REPORT_API_ENDPOINT);
      expect(JSON.parse(init.body as string)).toEqual({
        pubky: TEST_USER_PUBKY,
        postUrl: `https://example.com/marketplace/listing/${TEST_SELLER_PUBKY}/${TEST_LISTING_ID}`,
        issueType: REPORT_ISSUE_TYPES.ILLEGAL_SALES,
        reason: 'Sells counterfeit goods',
        name: TEST_USER_NAME,
        listingId: TEST_LISTING_ID,
        sellerPubky: TEST_SELLER_PUBKY,
      });
      expect(result.current.isSuccess).toBe(true);
    });

    it('never adds listing fields to a post report', async () => {
      const { result } = renderHook(() => useReportPost(POST_TARGET));
      act(() => {
        result.current.selectIssueType(REPORT_ISSUE_TYPES.HARASSMENT);
      });
      act(() => {
        result.current.handleReasonChange({ target: { value: 'Spam' } } as React.ChangeEvent<HTMLTextAreaElement>);
      });
      await act(async () => {
        await result.current.submit();
      });

      const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      const payload = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(payload).not.toHaveProperty('listingId');
      expect(payload).not.toHaveProperty('sellerPubky');
    });

    it('falls back to the reporter pubky when no profile name has loaded', async () => {
      mockUseCurrentUserProfile.mockReturnValue({ currentUserPubky: TEST_USER_PUBKY, userDetails: undefined });

      await submitListingReport();

      const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toMatchObject({ name: TEST_USER_PUBKY });
    });

    it('does not submit a listing report without a signed-in reporter', async () => {
      mockUseCurrentUserProfile.mockReturnValue({ currentUserPubky: null, userDetails: undefined });

      await submitListingReport();

      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith({ variant: 'error', description: 'Could not load profile' });
    });
  });

  describe('selectIssueType', () => {
    it('should update selectedIssueType and advance to reason step', () => {
      const { result } = renderHook(() => useReportPost(POST_TARGET));

      act(() => {
        result.current.selectIssueType(REPORT_ISSUE_TYPES.PERSONAL_INFO);
      });

      expect(result.current.selectedIssueType).toBe(REPORT_ISSUE_TYPES.PERSONAL_INFO);
      expect(result.current.step).toBe(REPORT_POST_STEPS.REASON_INPUT);
    });
  });

  describe('handleReasonChange', () => {
    it('should update reason when handleReasonChange is called', () => {
      const { result } = renderHook(() => useReportPost(POST_TARGET));

      act(() => {
        result.current.selectIssueType(REPORT_ISSUE_TYPES.PERSONAL_INFO);
      });

      act(() => {
        const event = {
          target: { value: 'This post contains harmful content' },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        result.current.handleReasonChange(event);
      });

      expect(result.current.reason).toBe('This post contains harmful content');
      expect(result.current.hasContent).toBe(true);
    });

    it('should accept reason value regardless of length (prevention handled by textarea maxLength)', () => {
      const { result } = renderHook(() => useReportPost(POST_TARGET));
      const longText = 'a'.repeat(REPORT_REASON_MAX_LENGTH + 10);

      act(() => {
        const event = {
          target: { value: longText },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        result.current.handleReasonChange(event);
      });

      expect(result.current.reason.length).toBe(REPORT_REASON_MAX_LENGTH + 10);
    });
  });

  describe('hasContent', () => {
    it('should be false when reason is empty', () => {
      const { result } = renderHook(() => useReportPost(POST_TARGET));
      expect(result.current.hasContent).toBe(false);
    });

    it('should be false when reason is only whitespace', () => {
      const { result } = renderHook(() => useReportPost(POST_TARGET));

      act(() => {
        const event = {
          target: { value: '   ' },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        result.current.handleReasonChange(event);
      });

      expect(result.current.hasContent).toBe(false);
    });

    it('should be true when reason has content', () => {
      const { result } = renderHook(() => useReportPost(POST_TARGET));

      act(() => {
        const event = {
          target: { value: 'Valid reason' },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        result.current.handleReasonChange(event);
      });

      expect(result.current.hasContent).toBe(true);
    });
  });

  describe('submit', () => {
    it('should not submit when reason is empty', async () => {
      const { result } = renderHook(() => useReportPost(POST_TARGET));

      act(() => {
        result.current.selectIssueType(REPORT_ISSUE_TYPES.PERSONAL_INFO);
      });

      await act(async () => {
        await result.current.submit();
      });

      expect(result.current.isSubmitting).toBe(false);
      expect(result.current.isSuccess).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should not submit when issue type is not selected', async () => {
      const { result } = renderHook(() => useReportPost(POST_TARGET));

      act(() => {
        const event = {
          target: { value: 'Some reason' },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        result.current.handleReasonChange(event);
      });

      await act(async () => {
        await result.current.submit();
      });

      expect(result.current.isSubmitting).toBe(false);
      expect(result.current.isSuccess).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should submit report and set isSuccess on success', async () => {
      const { result } = renderHook(() => useReportPost(POST_TARGET));

      act(() => {
        result.current.selectIssueType(REPORT_ISSUE_TYPES.PERSONAL_INFO);
      });

      act(() => {
        const event = {
          target: { value: 'This post leaks personal information' },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        result.current.handleReasonChange(event);
      });

      await act(async () => {
        await result.current.submit();
      });

      await waitFor(() => {
        expect(result.current.isSubmitting).toBe(false);
        expect(result.current.isSuccess).toBe(true);
      });

      expect(global.fetch).toHaveBeenCalledWith(REPORT_API_ENDPOINT, {
        method: HttpMethod.POST,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          pubky: TEST_USER_PUBKY,
          postUrl: TEST_POST_URL,
          issueType: REPORT_ISSUE_TYPES.PERSONAL_INFO,
          reason: 'This post leaks personal information',
          name: TEST_USER_NAME,
        }),
      });
    });

    it('should show toast when submission fails', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Server error' }),
      } as Response);

      const { result } = renderHook(() => useReportPost(POST_TARGET));

      act(() => {
        result.current.selectIssueType(REPORT_ISSUE_TYPES.PERSONAL_INFO);
      });

      act(() => {
        const event = {
          target: { value: 'Some reason' },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        result.current.handleReasonChange(event);
      });

      await act(async () => {
        await result.current.submit();
      });

      await waitFor(() => {
        expect(result.current.isSubmitting).toBe(false);
        expect(result.current.isSuccess).toBe(false);
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'error',
          description: 'Server error',
        }),
      );
    });

    it('should not submit when already submitting', async () => {
      let resolveFirstFetch: () => void;
      const firstFetchPromise = new Promise<void>((resolve) => {
        resolveFirstFetch = resolve;
      });

      (global.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
        await firstFetchPromise;
        return { ok: true, json: async () => ({}) } as Response;
      });

      const { result } = renderHook(() => useReportPost(POST_TARGET));

      act(() => {
        result.current.selectIssueType(REPORT_ISSUE_TYPES.PERSONAL_INFO);
      });

      act(() => {
        const event = {
          target: { value: 'Some reason' },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        result.current.handleReasonChange(event);
      });

      // Start first submission (don't await)
      let submitPromise: Promise<void>;
      act(() => {
        submitPromise = result.current.submit();
      });

      await waitFor(() => {
        expect(result.current.isSubmitting).toBe(true);
      });

      // Try to submit again while first is in progress
      await act(async () => {
        await result.current.submit();
      });

      // Resolve the first fetch
      resolveFirstFetch!();

      await act(async () => {
        await submitPromise!;
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
        expect(result.current.isSubmitting).toBe(false);
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should show toast when currentUserPubky is null', async () => {
      mockUseCurrentUserProfile.mockReturnValue({
        currentUserPubky: null,
        userDetails: { name: TEST_USER_NAME },
      });

      const { result } = renderHook(() => useReportPost(POST_TARGET));

      act(() => {
        result.current.selectIssueType(REPORT_ISSUE_TYPES.PERSONAL_INFO);
      });

      act(() => {
        const event = {
          target: { value: 'Some reason' },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        result.current.handleReasonChange(event);
      });

      await act(async () => {
        await result.current.submit();
      });

      expect(result.current.isSubmitting).toBe(false);
      expect(result.current.isSuccess).toBe(false);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'error',
          description: 'Could not load profile',
        }),
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should show toast when userDetails.name is missing', async () => {
      mockUseCurrentUserProfile.mockReturnValue({
        currentUserPubky: TEST_USER_PUBKY,
        userDetails: null,
      });

      const { result } = renderHook(() => useReportPost(POST_TARGET));

      act(() => {
        result.current.selectIssueType(REPORT_ISSUE_TYPES.PERSONAL_INFO);
      });

      act(() => {
        const event = {
          target: { value: 'Some reason' },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        result.current.handleReasonChange(event);
      });

      await act(async () => {
        await result.current.submit();
      });

      expect(result.current.isSubmitting).toBe(false);
      expect(result.current.isSuccess).toBe(false);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'error',
          description: 'Could not load profile',
        }),
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should show toast on network errors', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useReportPost(POST_TARGET));

      act(() => {
        result.current.selectIssueType(REPORT_ISSUE_TYPES.PERSONAL_INFO);
      });

      act(() => {
        const event = {
          target: { value: 'Some reason' },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        result.current.handleReasonChange(event);
      });

      await act(async () => {
        await result.current.submit();
      });

      await waitFor(() => {
        expect(result.current.isSubmitting).toBe(false);
        expect(result.current.isSuccess).toBe(false);
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'error',
          description: 'Network error',
        }),
      );
    });
  });

  describe('reset', () => {
    it('should reset all state when reset is called', async () => {
      const { result } = renderHook(() => useReportPost(POST_TARGET));

      // Set up some state
      act(() => {
        result.current.selectIssueType(REPORT_ISSUE_TYPES.PERSONAL_INFO);
      });

      act(() => {
        const event = {
          target: { value: 'Some reason' },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        result.current.handleReasonChange(event);
      });

      await act(async () => {
        await result.current.submit();
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      // Reset
      act(() => {
        result.current.reset();
      });

      expect(result.current.step).toBe(REPORT_POST_STEPS.ISSUE_SELECTION);
      expect(result.current.selectedIssueType).toBeNull();
      expect(result.current.reason).toBe('');
      expect(result.current.isSubmitting).toBe(false);
      expect(result.current.isSuccess).toBe(false);
    });
  });
});
