import { Env } from '@/libs/env/env';
import { getDeployEnv } from '@/libs/runtime-config/runtime-config';

export function getSocialHostUrl(path: string): string {
  if (Env.NEXT_PUBLIC_SOCIAL_HOST) return Env.NEXT_PUBLIC_SOCIAL_HOST + path;
  if (Env.NEXT_PUBLIC_BASE_PATH === '/shop-embed') return path;
  return (getDeployEnv() === 'staging' ? 'https://staging.pubky.app' : 'https://pubky.app') + path;
}

/** An explicit social host selects the standalone global nav layout. Both layouts delegate social routes to the App. */
export function usesSocialHostNavigation(): boolean {
  return Boolean(Env.NEXT_PUBLIC_SOCIAL_HOST);
}
