import { Env } from '@/libs/env/env';
import { socialHostForMount } from '@/libs/social-host/social-host';

export function getSocialHostUrl(path: string): string {
  return socialHostForMount(Env.NEXT_PUBLIC_SOCIAL_HOST, Env.NEXT_PUBLIC_BASE_PATH) + path;
}

/** An explicit social host selects the standalone global nav layout. Both layouts delegate social routes to the App. */
export function usesSocialHostNavigation(): boolean {
  return Boolean(Env.NEXT_PUBLIC_SOCIAL_HOST);
}
