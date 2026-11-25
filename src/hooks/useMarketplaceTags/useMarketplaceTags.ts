'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getMarketplaceListingRoute, getMarketplaceShopRoute } from '@/app/routes';
import { TagKind } from '@/application/tag/tag.types';
import { getSocialHostUrl } from '@/config/social';
import { CommerceController } from '@/controllers/commerce/commerce';
import { TagController } from '@/controllers/tag/tag';
import { normalizeLegacyTagLabel, normalizeSocialTagLabel } from '@/hooks/useTagInput/useTagInput.utils';
import { AppError, isAppError } from '@/libs/error/error';
import { isRetryable } from '@/libs/error/error.utils';
import { getTtlRetryDelayMs } from '@/libs/runtime-config/runtime-config';
import type { TagWithAvatars } from '@/molecules/TaggedItem/TaggedItem.types';
import { transformTagsForViewer } from '@/molecules/TaggedItem/TaggedItem.utils';
import { toast } from '@/molecules/Toaster/toast';
import { useAuthStore } from '@/stores/auth/auth.store';

export type MarketplaceTagTarget =
  | { kind: TagKind.LISTING; sellerPubky: string; listingId: string }
  | { kind: TagKind.SHOP; ownerPubky: string };

export interface UseMarketplaceTagsResult {
  tags: TagWithAvatars[];
  socialHandoffUrl?: string;
  normalizeLabel: (label: string) => string;
  handleTagAdd: (label: string) => Promise<{ success: boolean; error?: string }>;
  handleTagToggle: (tag: { label: string; relationship?: boolean }) => Promise<void>;
}

function targetTaggedId(target: MarketplaceTagTarget): string {
  return target.kind === TagKind.LISTING ? `${target.sellerPubky}:${target.listingId}` : target.ownerPubky;
}

/** Retry transient failures while this effect still owns the resource or session. A successful read stops the timer. */
function refreshTagRead<T>(read: () => Promise<T>, onSuccess?: (value: T) => void) {
  let active = true;
  let timer: number | undefined;
  const attempt = async () => {
    try {
      const value = await read();
      if (active) onSuccess?.(value);
    } catch (error) {
      if (active && (!isAppError(error) || isRetryable(error))) {
        timer = window.setTimeout(attempt, getTtlRetryDelayMs());
      }
    }
  };
  void attempt();
  return () => {
    active = false;
    window.clearTimeout(timer);
  };
}

function socialListingOrShopUrl(target: MarketplaceTagTarget) {
  const path =
    target.kind === TagKind.LISTING
      ? getMarketplaceListingRoute(target.sellerPubky, target.listingId)
      : getMarketplaceShopRoute(target.ownerPubky);
  return getSocialHostUrl(`/shop${path}`);
}

function showWriteError(error: unknown, fallback: string, target: MarketplaceTagTarget) {
  if (error instanceof AppError && error.operation === 'socialWrite') {
    toast({
      variant: 'info',
      description: error.message,
      action: {
        label: 'Open Pubky App',
        altText: 'Open this item in Pubky App',
        onClick: () => window.open(socialListingOrShopUrl(target), '_blank', 'noopener,noreferrer'),
      },
    });
    return;
  }
  toast({ variant: 'error', description: fallback });
}

/** Community tags on the canonical listing or shop URI, with optimistic local writes. */
export function useMarketplaceTags(target: MarketplaceTagTarget | null): UseMarketplaceTagsResult {
  const viewerId = useAuthStore((state) => state.currentUserPubky);
  const session = useAuthStore((state) => state.session);
  const sessionOwner = useAuthStore((state) => state.sessionOwner);
  const [access, setAccess] = useState<{
    owner: string;
    session: typeof session;
    sessionOwner: typeof sessionOwner;
    epoch: 'legacy' | 'v1' | null;
  } | null>(null);

  useEffect(() => {
    if (!viewerId || !session) return;
    return refreshTagRead(
      () => TagController.fetchWriteEpoch(viewerId),
      (epoch) => setAccess({ owner: viewerId, session, sessionOwner, epoch }),
    );
  }, [viewerId, session, sessionOwner]);
  const epoch =
    access?.owner === viewerId && access?.session === session && access?.sessionOwner === sessionOwner
      ? access?.epoch
      : undefined;
  const normalizeLabel = epoch === 'legacy' ? normalizeLegacyTagLabel : normalizeSocialTagLabel;
  const socialHandoffUrl =
    epoch === null && target
      ? sessionOwner === 'host'
        ? getSocialHostUrl('/')
        : socialListingOrShopUrl(target)
      : undefined;
  const targetKey = target ? `${target.kind}:${targetTaggedId(target)}` : null;

  const localTags = useLiveQuery(
    async () => {
      if (!target) return null;
      if (target.kind === TagKind.LISTING) {
        return await CommerceController.getListingTags(target.sellerPubky, target.listingId);
      }
      return await CommerceController.getShopTags(target.ownerPubky);
    },

    [targetKey],
    undefined,
  );

  useEffect(() => {
    if (!target) return;
    return refreshTagRead(() =>
      target.kind === TagKind.LISTING
        ? CommerceController.fetchListingTags(target.sellerPubky, target.listingId, viewerId ?? undefined)
        : CommerceController.fetchShopTags(target.ownerPubky, viewerId ?? undefined),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- targetKey encodes every field of target
  }, [targetKey, viewerId, session, sessionOwner]);

  const tags = transformTagsForViewer(localTags ?? [], viewerId);

  const handleTagAdd = useCallback(
    async (tagString: string): Promise<{ success: boolean; error?: string }> => {
      const label = tagString.trim();

      if (!label) return { success: false, error: 'Tag label cannot be empty' };
      if (!target) return { success: false, error: 'Tag target is required' };
      if (!viewerId) return { success: false, error: 'You must be logged in to add tags' };

      const existingTag = (localTags ?? []).find((t) => t.label === normalizeLabel(label));
      if (existingTag?.relationship || existingTag?.taggers?.includes(viewerId)) {
        return { success: false, error: 'You have already added this tag' };
      }

      try {
        await TagController.commitCreate({
          taggedId: targetTaggedId(target),
          label,
          taggerId: viewerId,
          taggedKind: target.kind,
        });
        toast({ title: `Tag added: ${label}` });
        return { success: true };
      } catch (error) {
        showWriteError(error, `Could not add tag: ${label}`, target);
        return { success: false, error: 'Failed to add tag' };
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- targetKey encodes every field of target
    [targetKey, viewerId, localTags, normalizeLabel],
  );

  const handleTagToggle = useCallback(
    async (tag: { label: string; relationship?: boolean }): Promise<void> => {
      if (!target || !viewerId) return;

      const currentTag = (localTags ?? []).find((t) => t.label === tag.label);
      const userIsTagger =
        tag.relationship ?? currentTag?.relationship ?? currentTag?.taggers?.includes(viewerId) ?? false;

      try {
        if (userIsTagger) {
          await TagController.commitDelete({
            taggedId: targetTaggedId(target),
            label: tag.label,
            taggerId: viewerId,
            taggedKind: target.kind,
          });
          toast({ title: `Tag removed: ${tag.label}` });
        } else {
          await TagController.commitCreate({
            taggedId: targetTaggedId(target),
            label: tag.label,
            taggerId: viewerId,
            taggedKind: target.kind,
          });
          toast({ title: `Tag added: ${tag.label}` });
        }
      } catch (error) {
        showWriteError(
          error,
          userIsTagger ? `Could not remove tag: ${tag.label}` : `Could not add tag: ${tag.label}`,
          target,
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- targetKey encodes every field of target
    [targetKey, viewerId, localTags],
  );

  return { tags, socialHandoffUrl, normalizeLabel, handleTagAdd, handleTagToggle };
}
