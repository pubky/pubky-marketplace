// Nexus by_ids endpoints reject requests with more than 100 ids. A larger
// `chunkSize` passed to `fetchByIdsInChunks` is not clamped to this cap.
export const NEXUS_BY_IDS_MAX = 100;

export async function fetchByIdsInChunks<TId, TResult>(
  ids: readonly TId[],
  fetchChunk: (chunk: TId[]) => Promise<TResult[]>,
  chunkSize: number = NEXUS_BY_IDS_MAX,
): Promise<TResult[]> {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new RangeError('chunkSize must be a positive integer');
  }

  const results: TResult[] = [];
  for (let start = 0; start < ids.length; start += chunkSize) {
    const chunkResults = await fetchChunk(ids.slice(start, start + chunkSize));
    results.push(...chunkResults);
  }
  return results;
}
