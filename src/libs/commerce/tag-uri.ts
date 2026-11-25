const LEGACY_TAGS_PATH = '/pub/pubky.app/tags/';
const SOCIAL_TAGS_PATH = '/pub/social/v1/tags/';

export function parseViewerTagUrl(owner: string, url: string | null | undefined) {
  const ownerUrl = `pubky://${owner}`;
  if (!url?.startsWith(ownerUrl + '/')) return;
  const path = url.slice(ownerUrl.length);
  const legacy = path.startsWith(LEGACY_TAGS_PATH);
  if (!legacy && !(path.startsWith(SOCIAL_TAGS_PATH) && path.endsWith('.json'))) return;
  const id = legacy ? path.slice(LEGACY_TAGS_PATH.length) : path.slice(SOCIAL_TAGS_PATH.length, -'.json'.length);
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) return;
  return { id, legacy };
}

/** Candidates only: the caller verifies each stored record's target and label before deletion. */
export function marketplaceTagCopyUrls(
  owner: string,
  tagUrl: string,
  indexedUrl: string | undefined,
  canDeleteLegacy: boolean,
) {
  const active = parseViewerTagUrl(owner, tagUrl);
  if (!active) return [];
  const indexed = parseViewerTagUrl(owner, indexedUrl);
  const ids = new Set([active.id]);
  if (indexed && (!active.legacy || indexed.legacy)) ids.add(indexed.id);
  const copies: string[] = [];
  const ownerUrl = `pubky://${owner}`;
  if (active.legacy || canDeleteLegacy) {
    for (const id of ids) copies.push(`${ownerUrl}${LEGACY_TAGS_PATH}${id}`);
  }
  if (!active.legacy) {
    for (const id of ids) copies.push(`${ownerUrl}${SOCIAL_TAGS_PATH}${id}.json`);
  }
  return copies.filter((url) => url !== tagUrl);
}
