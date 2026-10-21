import { NextResponse } from 'next/server';
import { HttpStatusCode } from '@/libs/http/http.types';

export type TReadJsonBodyResult = { ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse };

/**
 * Reads a request body as a JSON object, reading at most `maxBytes`.
 * A declared Content-Length over the cap is refused before reading; the
 * header is not trusted otherwise, so the stream is counted as it arrives and
 * cancelled as soon as it passes the cap.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<TReadJsonBodyResult> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return tooLarge();
  if (!request.body) return notAnObject();

  const bytes = await readUpTo(request.body, maxBytes);
  if (!bytes) return tooLarge();

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return failure(HttpStatusCode.BAD_REQUEST, 'Request body is not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return notAnObject();
  return { ok: true, body: parsed as Record<string, unknown> };
}

/** Returns the whole stream, or null once it passes `maxBytes` (the stream is then cancelled). */
async function readUpTo(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function tooLarge(): TReadJsonBodyResult {
  return failure(HttpStatusCode.PAYLOAD_TOO_LARGE, 'Request body is too large.');
}

function notAnObject(): TReadJsonBodyResult {
  return failure(HttpStatusCode.BAD_REQUEST, 'Request body must be a JSON object.');
}

function failure(status: number, error: string): TReadJsonBodyResult {
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}
