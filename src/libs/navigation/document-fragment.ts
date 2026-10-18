const takenFragments = new Set<string>();

/**
 * The page's `#fragment`, handed out at most once per document for each path and fragment.
 * After a document load with a fragment, Next appends it to every later in-app navigation to
 * the same path (#292), so an old `#…` deep link is acted on once and then replaced.
 */
export function takeDocumentFragment(location: Pick<Location, 'pathname' | 'hash'>): string | null {
  if (location.hash.length <= 1) return null;
  const key = `${location.pathname}${location.hash}`;
  if (takenFragments.has(key)) return null;
  takenFragments.add(key);
  return location.hash;
}
