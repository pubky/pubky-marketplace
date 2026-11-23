'use client';

import { isStoreMode } from '@/config/store-mode';
import { getTtlUserMs } from '@/config/sync';
import { UserController } from '@/controllers/user/user';
import { useLocalFirstQuery } from '@/hooks/useLocalFirstQuery/useLocalFirstQuery';
import { isHomeserverProfileStale } from '@/pipes/user/homeserver-profile';
import type { NexusUserDetails } from '@/services/nexus/nexus.types';
import type { UseUserDetailsResult } from './useUserDetails.types';

/**
 * Hook to get user details from local database with live updates.
 * If the user is not in cache, it will trigger a fetch from Nexus.
 *
 * Uses the local-first query pattern (ADR-0011) via `useLocalFirstQuery`:
 * 1. fetchFn (useEffect): Ensures data exists (fetch full entity from Nexus if missing)
 * 2. queryFn (useLiveQuery): Reads current data reactively from local DB
 *
 * @param userId - The user ID to fetch details for (can be null/undefined)
 * @returns User details and loading state
 *
 * @example
 * ```tsx
 * const { userDetails, isLoading } = useUserDetails(userId);
 * if (isLoading) return <Skeleton />;
 * return <span>{userDetails?.name ?? 'Unknown'}</span>;
 * ```
 */
export function useUserDetails(userId: string | null | undefined): UseUserDetailsResult {
  const { data, isLoading } = useLocalFirstQuery<NexusUserDetails>({
    queryFn: () => UserController.getDetails({ userId: userId! }),
    fetchFn: () => UserController.fetchDetails({ userId: userId! }),
    deps: [userId],
    enabled: !!userId,
    // A store has no TTL coordinator, so a profile past the user TTL is re-read from its homeserver.
    isStale: isStoreMode() ? (details) => isHomeserverProfileStale(details, getTtlUserMs(), Date.now()) : undefined,
  });

  return {
    userDetails: data,
    isLoading,
  };
}
