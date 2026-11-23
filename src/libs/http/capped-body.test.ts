/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { readBodyWithin } from './capped-body';

const CHUNK = 1024;

/** An endless body of `CHUNK`-byte chunks that records how much was pulled and whether it was cancelled. */
function endlessBody() {
  const state = { pulledBytes: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pulledBytes += CHUNK;
        controller.enqueue(new Uint8Array(CHUNK).fill(120));
      },
      cancel() {
        state.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, state };
}

describe('readBodyWithin', () => {
  it('returns a body within the limit', async () => {
    const body = await readBodyWithin(new Response('{"ok":true}'), 16);
    expect(new TextDecoder().decode(body!)).toBe('{"ok":true}');
  });

  it('returns an empty body for a response without one', async () => {
    await expect(readBodyWithin(new Response(null), 16)).resolves.toEqual(new Uint8Array(0));
  });

  it('stops reading an endless stream at the limit and cancels it', async () => {
    const { stream, state } = endlessBody();

    await expect(readBodyWithin(new Response(stream), 16 * CHUNK)).resolves.toBeNull();

    expect(state.pulledBytes).toBeLessThanOrEqual(17 * CHUNK);
    expect(state.cancelled).toBe(true);
  });

  it('refuses a declared length over the limit without reading the body', async () => {
    const { stream, state } = endlessBody();
    const response = new Response(stream, { headers: { 'content-length': String(64 * 1024 * 1024) } });

    await expect(readBodyWithin(response, 16 * CHUNK)).resolves.toBeNull();

    expect(state.pulledBytes).toBe(0);
    expect(state.cancelled).toBe(true);
  });

  it('still stops at the limit when the declared length is a lie', async () => {
    const { stream, state } = endlessBody();
    const response = new Response(stream, { headers: { 'content-length': '10' } });

    await expect(readBodyWithin(response, 16 * CHUNK)).resolves.toBeNull();

    expect(state.pulledBytes).toBeLessThanOrEqual(17 * CHUNK);
    expect(state.cancelled).toBe(true);
  });

  it('ignores a declared length that is not a number and reads within the limit', async () => {
    const response = new Response('abc', { headers: { 'content-length': 'lots' } });
    const body = await readBodyWithin(response, 16);
    expect(new TextDecoder().decode(body!)).toBe('abc');
  });
});
