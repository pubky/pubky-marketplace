import { describe, expect, it, test, vi } from 'vitest';
import { fetchByIdsInChunks } from './nexus.by-ids';

describe('fetchByIdsInChunks', () => {
  test.each([
    { count: 0, chunkSizes: [] },
    { count: 1, chunkSizes: [1] },
    { count: 100, chunkSizes: [100] },
    { count: 101, chunkSizes: [100, 1] },
    { count: 250, chunkSizes: [100, 100, 50] },
  ])(
    'splits $count ids into chunks of $chunkSizes and merges their results in order',
    async ({ count, chunkSizes }) => {
      const ids = Array.from({ length: count }, (_, index) => `id-${index}`);
      const chunks: string[][] = [];
      const fetchChunk = vi.fn(async (chunk: string[]) => {
        chunks.push(chunk);
        return chunk.map((id) => `result:${id}`);
      });

      const result = await fetchByIdsInChunks(ids, fetchChunk);

      expect(fetchChunk).toHaveBeenCalledTimes(chunkSizes.length);
      expect(chunks.map((chunk) => chunk.length)).toEqual(chunkSizes);
      expect(chunks.every((chunk) => chunk.length <= 100)).toBe(true);
      expect(chunks.flat()).toEqual(ids);
      expect(result).toEqual(ids.map((id) => `result:${id}`));
    },
  );

  it('waits for each chunk before starting the next', async () => {
    let resolveFirst!: (results: string[]) => void;
    const firstChunk = new Promise<string[]>((resolve) => {
      resolveFirst = resolve;
    });
    const events: string[] = [];
    const fetchChunk = vi.fn(async (chunk: string[]) => {
      events.push(`start:${chunk[0]}`);
      if (chunk[0] === 'id-0') {
        const results = await firstChunk;
        events.push(`finish:${chunk[0]}`);
        return results;
      }
      events.push(`finish:${chunk[0]}`);
      return chunk.map((id) => `result:${id}`);
    });

    const pending = fetchByIdsInChunks(['id-0', 'id-1'], fetchChunk, 1);

    expect(fetchChunk).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['start:id-0']);

    resolveFirst(['result:id-0']);

    await expect(pending).resolves.toEqual(['result:id-0', 'result:id-1']);
    expect(events).toEqual(['start:id-0', 'finish:id-0', 'start:id-1', 'finish:id-1']);
  });

  it('rejects with the chunk error and does not request later chunks', async () => {
    const error = new Error('Chunk request failed');
    const fetchChunk = vi
      .fn<(chunk: string[]) => Promise<string[]>>()
      .mockResolvedValueOnce(['first'])
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(['third']);

    await expect(fetchByIdsInChunks(['id-0', 'id-1', 'id-2'], fetchChunk, 1)).rejects.toBe(error);
    expect(fetchChunk).toHaveBeenCalledTimes(2);
  });

  test.each([0, -1, 1.5])('rejects invalid chunk size %s', async (chunkSize) => {
    const fetchChunk = vi.fn();

    await expect(fetchByIdsInChunks(['id-0'], fetchChunk, chunkSize)).rejects.toBeInstanceOf(RangeError);
    expect(fetchChunk).not.toHaveBeenCalled();
  });
});
