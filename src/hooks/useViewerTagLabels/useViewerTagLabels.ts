'use client';

import { useEffect, useState } from 'react';
import { TagController } from '@/controllers/tag/tag';

/** Most of the viewer's own labels offered as suggestions. */
export const VIEWER_TAG_LABEL_SUGGESTIONS_MAX = 8;

/**
 * The labels the viewer most often put on users, from this device's local
 * copy of user tags (so only users it has seen). Empty while loading and when
 * the device holds none; a read failure also reads as none, because the
 * suggestions are a convenience beside a free text entry.
 */
export function useViewerTagLabels(viewerPubky: string): string[] {
  const [labels, setLabels] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    setLabels([]);
    TagController.getViewerUserTagLabels(viewerPubky, VIEWER_TAG_LABEL_SUGGESTIONS_MAX)
      .then((found) => {
        if (active) setLabels(found);
      })
      .catch(() => {
        if (active) setLabels([]);
      });
    return () => {
      active = false;
    };
  }, [viewerPubky]);

  return labels;
}
