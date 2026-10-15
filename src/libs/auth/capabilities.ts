import { validateCapabilities } from '@synonymdev/pubky';
import { CORE_CAPABILITIES } from '@/config/app';

/** Effective scope coverage: broader/root prefixes and split actions are accepted. */
export function capabilitiesCover(capabilities: readonly string[], required: string): boolean {
  const parse = (value: string) =>
    validateCapabilities(value)
      .split(',')
      .map((entry) => {
        const at = entry.lastIndexOf(':');
        return { path: entry.slice(0, at), actions: entry.slice(at + 1) };
      });
  try {
    const grants = parse(capabilities.join(','));
    return parse(required).every((need) =>
      [...need.actions].every((action) =>
        grants.some(
          (grant) =>
            (need.path === grant.path || (grant.path.endsWith('/') && need.path.startsWith(grant.path))) &&
            grant.actions.includes(action),
        ),
      ),
    );
  } catch {
    return false;
  }
}

export function capabilitiesMatchFullGrant(capabilities: readonly string[]): boolean {
  return capabilitiesCover(capabilities, CORE_CAPABILITIES);
}
