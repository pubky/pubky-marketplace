import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TagController } from '@/controllers/tag/tag';
import { useViewerTagLabels, VIEWER_TAG_LABEL_SUGGESTIONS_MAX } from './useViewerTagLabels';

const VIEWER = 'v'.repeat(52);

describe('useViewerTagLabels', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is empty until the labels are read, then lists them', async () => {
    const read = vi.spyOn(TagController, 'getViewerUserTagLabels').mockResolvedValue(['trusted', 'fast']);

    const { result } = renderHook(() => useViewerTagLabels(VIEWER));

    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current).toEqual(['trusted', 'fast']));
    expect(read).toHaveBeenCalledWith(VIEWER, VIEWER_TAG_LABEL_SUGGESTIONS_MAX);
  });

  it('reads a failure as no suggestions', async () => {
    const read = vi.spyOn(TagController, 'getViewerUserTagLabels').mockRejectedValue(new Error('db'));

    const { result } = renderHook(() => useViewerTagLabels(VIEWER));

    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it('drops an answer that arrives after the component unmounted', async () => {
    let resolve: (labels: string[]) => void = () => undefined;
    vi.spyOn(TagController, 'getViewerUserTagLabels').mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );

    const { result, unmount } = renderHook(() => useViewerTagLabels(VIEWER));
    unmount();
    resolve(['late']);
    await Promise.resolve();

    expect(result.current).toEqual([]);
  });
});
