import type { Pubky } from '@/models/models.types';
import { COMPOSITE_ID_DELIMITER } from './models.defaults';
import type { CompositeIdParams, CompositeIdResult } from './models.types';

const PUBKY_URI_PREFIX = 'pubky://';
/** A pubky authority is a bare public key: userinfo (`@`) or a port (`:`) would corrupt the composite id. */
const PUBKY_AUTHORITY = /^[^:@]+$/;

/**
 * Parses a pubky:// URI to extract the author and ID,
 * then builds a composite ID in the format "author:id"
 *
 * @param uri - A pubky URI (e.g., "pubky://author/pub/pubky.app/posts/post123")
 * @param domain - The domain of the URI (e.g., "posts", "files")
 * @returns Composite ID in "author:id" format, or null if parsing fails
 *
 * @example
 * buildCompositeIdFromUri("pubky://author123/pub/pubky.app/files/file456")
 * // Returns: "author123:file456"
 */
export function buildCompositeIdFromPubkyUri({ uri, domain }: CompositeIdParams): string | null {
  // Parsed by hand: `new URL('pubky://…').hostname` is empty on Chrome before 130 (non-special schemes).
  // The scheme is case-insensitive (`PUBKY://…` is valid); the authority keeps its case.
  if (uri.slice(0, PUBKY_URI_PREFIX.length).toLowerCase() !== PUBKY_URI_PREFIX) {
    return null;
  }
  // The authority is the first component; a missing one (`pubky:///…`) stays empty and is rejected.
  const [pubky, ...pathSegments] = uri.slice(PUBKY_URI_PREFIX.length).split(/[?#]/, 1)[0].split('/');
  const segments = pathSegments.filter(Boolean);
  const domainIndex = segments.lastIndexOf(domain);
  const id = domainIndex !== -1 ? segments[domainIndex + 1] : undefined;

  if (!PUBKY_AUTHORITY.test(pubky) || !id) {
    return null;
  }

  return buildCompositeId({ pubky, id });
}

export function buildCompositeId({ pubky, id }: CompositeIdResult): string {
  return `${pubky}${COMPOSITE_ID_DELIMITER}${id}`;
}

export function parseCompositeId(compositeId: string): CompositeIdResult {
  const sep = compositeId.indexOf(COMPOSITE_ID_DELIMITER);
  if (sep <= 0 || sep === compositeId.length - 1) {
    throw new Error(`Invalid composite id: ${compositeId}`);
  }
  const pubky = compositeId.substring(0, sep) as Pubky;
  const id = compositeId.substring(sep + 1);
  return { pubky, id };
}
