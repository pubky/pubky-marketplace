import { PubkyAppFeedLayout, PubkyAppFeedReach, PubkyAppFeedSort, PubkyAppPostKind } from 'pubky-app-specs';
import { describe, expect, it } from 'vitest';
import { CONTENT, LAYOUT, REACH, SORT } from '@/stores/home/home.types';
import {
  pubkyLayoutToHomeLayout,
  pubkyPostKindToHomeContent,
  pubkyReachToHomeReach,
  pubkySortToHomeSort,
} from './pubky-app-spec-feed-mappers';

describe('pubky-app-spec-feed-mappers', () => {
  describe('Layout Mappers', () => {
    describe('pubkyLayoutToHomeLayout', () => {
      it('should map PubkyAppFeedLayout.Columns to LAYOUT.COLUMNS', () => {
        expect(pubkyLayoutToHomeLayout(PubkyAppFeedLayout.Columns)).toBe(LAYOUT.COLUMNS);
      });

      it('should map PubkyAppFeedLayout.Wide to LAYOUT.WIDE', () => {
        expect(pubkyLayoutToHomeLayout(PubkyAppFeedLayout.Wide)).toBe(LAYOUT.WIDE);
      });

      it('should map PubkyAppFeedLayout.Visual to LAYOUT.VISUAL', () => {
        expect(pubkyLayoutToHomeLayout(PubkyAppFeedLayout.Visual)).toBe(LAYOUT.VISUAL);
      });

      it('should return undefined for unknown layout values', () => {
        expect(pubkyLayoutToHomeLayout(999 as PubkyAppFeedLayout)).toBeUndefined();
      });
    });
  });

  describe('Reach Mappers', () => {
    describe('pubkyReachToHomeReach', () => {
      it('should map PubkyAppFeedReach.Following to REACH.FOLLOWING', () => {
        expect(pubkyReachToHomeReach(PubkyAppFeedReach.Following)).toBe(REACH.FOLLOWING);
      });

      it('should map PubkyAppFeedReach.Friends to REACH.FRIENDS', () => {
        expect(pubkyReachToHomeReach(PubkyAppFeedReach.Friends)).toBe(REACH.FRIENDS);
      });

      it('should map PubkyAppFeedReach.All to REACH.ALL', () => {
        expect(pubkyReachToHomeReach(PubkyAppFeedReach.All)).toBe(REACH.ALL);
      });

      it('should map PubkyAppFeedReach.Wot to REACH.NETWORK', () => {
        expect(pubkyReachToHomeReach(PubkyAppFeedReach.Wot)).toBe(REACH.NETWORK);
      });

      it('should map PubkyAppFeedReach.Me to REACH.ME', () => {
        expect(pubkyReachToHomeReach(PubkyAppFeedReach.Me)).toBe(REACH.ME);
      });

      it('should return undefined for PubkyAppFeedReach.Followers (no home equivalent)', () => {
        expect(pubkyReachToHomeReach(PubkyAppFeedReach.Followers)).toBeUndefined();
      });

      it('should return undefined for unknown reach values', () => {
        expect(pubkyReachToHomeReach(999 as PubkyAppFeedReach)).toBeUndefined();
      });
    });
  });

  describe('Sort Mappers', () => {
    describe('pubkySortToHomeSort', () => {
      it('should map PubkyAppFeedSort.Recent to SORT.TIMELINE', () => {
        expect(pubkySortToHomeSort(PubkyAppFeedSort.Recent)).toBe(SORT.TIMELINE);
      });

      it('should map PubkyAppFeedSort.Popularity to SORT.ENGAGEMENT', () => {
        expect(pubkySortToHomeSort(PubkyAppFeedSort.Popularity)).toBe(SORT.ENGAGEMENT);
      });

      it('should return undefined for unknown sort values', () => {
        expect(pubkySortToHomeSort(999 as PubkyAppFeedSort)).toBeUndefined();
      });
    });
  });

  describe('Content/PostKind Mappers', () => {
    describe('pubkyPostKindToHomeContent', () => {
      it('should map PubkyAppPostKind.Short to CONTENT.SHORT', () => {
        expect(pubkyPostKindToHomeContent(PubkyAppPostKind.Short)).toBe(CONTENT.SHORT);
      });

      it('should map PubkyAppPostKind.Long to CONTENT.LONG', () => {
        expect(pubkyPostKindToHomeContent(PubkyAppPostKind.Long)).toBe(CONTENT.LONG);
      });

      it('should map PubkyAppPostKind.Image to CONTENT.IMAGES', () => {
        expect(pubkyPostKindToHomeContent(PubkyAppPostKind.Image)).toBe(CONTENT.IMAGES);
      });

      it('should map PubkyAppPostKind.Video to CONTENT.VIDEOS', () => {
        expect(pubkyPostKindToHomeContent(PubkyAppPostKind.Video)).toBe(CONTENT.VIDEOS);
      });

      it('should map PubkyAppPostKind.Link to CONTENT.LINKS', () => {
        expect(pubkyPostKindToHomeContent(PubkyAppPostKind.Link)).toBe(CONTENT.LINKS);
      });

      it('should map PubkyAppPostKind.File to CONTENT.FILES', () => {
        expect(pubkyPostKindToHomeContent(PubkyAppPostKind.File)).toBe(CONTENT.FILES);
      });

      it('should map PubkyAppPostKind.Collection to CONTENT.COLLECTIONS', () => {
        expect(pubkyPostKindToHomeContent(PubkyAppPostKind.Collection)).toBe(CONTENT.COLLECTIONS);
      });

      it('should return undefined for unknown post kind values', () => {
        expect(pubkyPostKindToHomeContent(999 as PubkyAppPostKind)).toBeUndefined();
      });
    });
  });
});
