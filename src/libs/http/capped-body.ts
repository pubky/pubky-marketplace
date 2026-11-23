/**
 * A response body of at most `limit` bytes, or `null` when it is larger.
 *
 * A declared `content-length` over the limit is refused without reading. Whatever the header
 * says, the stream is read chunk by chunk and cancelled as soon as it passes the limit, so a
 * host that lies about the length or streams without one never gets more than one chunk past
 * the limit into memory.
 */
export async function readBodyWithin(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = response.headers.get('content-length')?.trim();
  if (declared && /^\d+$/.test(declared) && Number(declared) > limit) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return new Uint8Array(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
