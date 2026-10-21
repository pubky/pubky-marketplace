import { describe, expect, it, vi } from 'vitest';
import { readJsonBody } from './read-json-body';

const ROUTE_URL = 'http://localhost:3000/api/feedback';
const MAX_BYTES = 1024;

function chunkedStream(chunks: string[], onCancel = vi.fn()) {
  const encoder = new TextEncoder();
  let next = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (next < chunks.length) controller.enqueue(encoder.encode(chunks[next++]));
      else controller.close();
    },
    cancel: onCancel,
  });
}

function streamedRequest(body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  // `duplex` is required by Node for a stream body but missing from the DOM RequestInit type.
  return new Request(ROUTE_URL, { method: 'POST', headers, body, duplex: 'half' } as RequestInit);
}

async function errorOf(response: Response) {
  return ((await response.json()) as { error: string }).error;
}

describe('readJsonBody', () => {
  it('returns a body object within the cap', async () => {
    const request = new Request(ROUTE_URL, { method: 'POST', body: JSON.stringify({ comment: 'hello' }) });

    const result = await readJsonBody(request, MAX_BYTES);

    expect(result).toEqual({ ok: true, body: { comment: 'hello' } });
  });

  it('reassembles a body sent in several chunks', async () => {
    const request = streamedRequest(chunkedStream(['{"comm', 'ent":"hel', 'lo"}']));

    const result = await readJsonBody(request, MAX_BYTES);

    expect(result).toEqual({ ok: true, body: { comment: 'hello' } });
  });

  it('caps a body that declares no length and stops reading it', async () => {
    const onCancel = vi.fn();
    const chunk = 'x'.repeat(400);
    const request = streamedRequest(chunkedStream(['"', chunk, chunk, chunk, chunk, '"'], onCancel));

    const result = await readJsonBody(request, MAX_BYTES);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(413);
      expect(await errorOf(result.response)).toBe('Request body is too large.');
    }
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('caps a body larger than its declared length', async () => {
    const chunk = 'x'.repeat(600);
    const request = streamedRequest(chunkedStream([chunk, chunk]), { 'content-length': '10' });

    const result = await readJsonBody(request, MAX_BYTES);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  it('refuses a declared length over the cap without reading the body', async () => {
    const request = streamedRequest(chunkedStream(['{}']), { 'content-length': String(MAX_BYTES + 1) });

    const result = await readJsonBody(request, MAX_BYTES);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
    expect(request.bodyUsed).toBe(false);
  });

  it('rejects a body that is not valid JSON', async () => {
    const request = new Request(ROUTE_URL, { method: 'POST', body: 'invalid json' });

    const result = await readJsonBody(request, MAX_BYTES);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      expect(await errorOf(result.response)).toBe('Request body is not valid JSON.');
    }
  });

  it.each([
    ['an array', '[1, 2]'],
    ['null', 'null'],
    ['a string', '"text"'],
  ])('rejects a JSON body that is %s rather than an object', async (_label, body) => {
    const result = await readJsonBody(new Request(ROUTE_URL, { method: 'POST', body }), MAX_BYTES);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      expect(await errorOf(result.response)).toBe('Request body must be a JSON object.');
    }
  });

  it('rejects a request without a body', async () => {
    const result = await readJsonBody(new Request(ROUTE_URL, { method: 'POST' }), MAX_BYTES);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });
});
