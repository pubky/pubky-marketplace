import { shopStorageKey } from '@/libs/storage-namespace/storage-namespace';

/** Prefix for `sessionStorage` keys storing the last HS events-stream cursor per user. */
export const MUTE_SYNC_CURSOR_STORAGE_PREFIX = shopStorageKey('pubky-app:mute-sync-cursor:');
