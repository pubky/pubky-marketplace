import { ed25519 } from '@noble/curves/ed25519.js';
import { PublicKey } from '@synonymdev/pubky';
import { readBodyWithin } from '@/libs/http/capped-body';

const SIGNATURE_BYTES = 64;
const TIMESTAMP_BYTES = 8;
/** Pkarr caps a record's DNS packet at 1000 bytes; a relay answers signature, timestamp and packet. */
const MAX_PACKET_BYTES = 1000;
const MAX_RELAY_BODY_BYTES = SIGNATURE_BYTES + TIMESTAMP_BYTES + MAX_PACKET_BYTES;
const DNS_HEADER_BYTES = 12;
const DNS_TYPE_SVCB = 64;
const DNS_TYPE_HTTPS = 65;
const SVC_PARAM_PORT = 3;
const MAX_NAME_POINTER_HOPS = 16;
const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type HomeserverEndpointDeps = {
  relays: readonly string[];
  fetchRelay: (url: URL, init: RequestInit) => Promise<Response>;
  timeoutMs: number;
};

/**
 * The HTTPS origin a homeserver publishes in its own Pkarr record, or `null` when no relay
 * returns a record signed by that key with a usable endpoint.
 *
 * Every relay is asked; only packets whose signature verifies against `homeserverZ32` count,
 * and the most recent one wins. The endpoint is the lowest-priority HTTPS (or SVCB) service
 * record for the key whose target is a DNS hostname on port 443: records naming the root (an
 * IP-only endpoint), another Pkarr key, a single-label host or another port are skipped. The
 * hostname still has to pass the caller's SSRF checks before anything connects to it.
 */
export async function resolveHomeserverHttpsOrigin(
  homeserverZ32: string,
  deps: HomeserverEndpointDeps,
): Promise<string | null> {
  let publicKey: Uint8Array;
  try {
    publicKey = PublicKey.from(homeserverZ32).toUint8Array();
  } catch {
    return null;
  }
  const answers = await Promise.allSettled(deps.relays.map((relay) => readRelay(relay, homeserverZ32, deps)));
  let latest: { timestamp: bigint; packet: Uint8Array } | null = null;
  for (const answer of answers) {
    if (answer.status !== 'fulfilled' || answer.value === null) continue;
    const verified = verifySignedPacket(answer.value, publicKey);
    if (verified && (latest === null || verified.timestamp > latest.timestamp)) latest = verified;
  }
  return latest ? httpsOriginFromPacket(latest.packet, homeserverZ32) : null;
}

async function readRelay(relay: string, z32: string, deps: HomeserverEndpointDeps): Promise<Uint8Array | null> {
  const url = new URL(`${relay.replace(/\/+$/, '')}/${z32}`);
  const response = await deps.fetchRelay(url, {
    method: 'GET',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(deps.timeoutMs),
  });
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  return await readBodyWithin(response, MAX_RELAY_BODY_BYTES);
}

/**
 * A relay's answer (`signature ‖ timestamp ‖ packet`), checked against the key: the signature
 * covers the BEP 44 encoding `3:seqi<timestamp>e1:v<length>:<packet>`, as Pkarr signs it.
 */
export function verifySignedPacket(
  body: Uint8Array,
  publicKey: Uint8Array,
): { timestamp: bigint; packet: Uint8Array } | null {
  if (body.length < SIGNATURE_BYTES + TIMESTAMP_BYTES || body.length > MAX_RELAY_BODY_BYTES) return null;
  const signature = body.subarray(0, SIGNATURE_BYTES);
  const timestamp = new DataView(body.buffer, body.byteOffset + SIGNATURE_BYTES, TIMESTAMP_BYTES).getBigUint64(0);
  const packet = body.subarray(SIGNATURE_BYTES + TIMESTAMP_BYTES);
  const prefix = new TextEncoder().encode(`3:seqi${timestamp}e1:v${packet.length}:`);
  const signable = new Uint8Array(prefix.length + packet.length);
  signable.set(prefix);
  signable.set(packet, prefix.length);
  try {
    return ed25519.verify(signature, signable, publicKey) ? { timestamp, packet } : null;
  } catch {
    return null;
  }
}

/** The HTTPS origin of a homeserver's DNS packet (see {@link resolveHomeserverHttpsOrigin}), or `null`. */
export function httpsOriginFromPacket(packet: Uint8Array, homeserverZ32: string): string | null {
  if (packet.length < DNS_HEADER_BYTES) return null;
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const questionCount = view.getUint16(4);
  const answerCount = view.getUint16(6);
  let offset = DNS_HEADER_BYTES;
  for (let index = 0; index < questionCount; index += 1) {
    const question = readName(packet, offset);
    if (!question || question.next + 4 > packet.length) return null;
    offset = question.next + 4;
  }

  const services: { priority: number; hostname: string }[] = [];
  for (let index = 0; index < answerCount; index += 1) {
    const owner = readName(packet, offset);
    if (!owner || owner.next + 10 > packet.length) return null;
    const type = view.getUint16(owner.next);
    const dataStart = owner.next + 10;
    const dataEnd = dataStart + view.getUint16(owner.next + 8);
    if (dataEnd > packet.length) return null;
    offset = dataEnd;
    if ((type !== DNS_TYPE_HTTPS && type !== DNS_TYPE_SVCB) || owner.name !== homeserverZ32) continue;
    const service = readServiceRecord(packet, view, dataStart, dataEnd);
    if (service) services.push(service);
  }

  services.sort((left, right) => left.priority - right.priority);
  return services.length > 0 ? `https://${services[0].hostname}` : null;
}

function readServiceRecord(
  packet: Uint8Array,
  view: DataView,
  start: number,
  end: number,
): { priority: number; hostname: string } | null {
  if (start + 2 > end) return null;
  const priority = view.getUint16(start);
  // Priority 0 is AliasMode: it names another service, not an endpoint.
  if (priority === 0) return null;
  const target = readName(packet, start + 2);
  if (!target || target.next > end) return null;
  let offset = target.next;
  while (offset < end) {
    if (offset + 4 > end) return null;
    const key = view.getUint16(offset);
    const length = view.getUint16(offset + 2);
    if (offset + 4 + length > end) return null;
    if (key === SVC_PARAM_PORT && (length !== 2 || view.getUint16(offset + 4) !== 443)) return null;
    offset += 4 + length;
  }
  return isDnsHostname(target.name) ? { priority, hostname: target.name } : null;
}

function isDnsHostname(name: string): boolean {
  const labels = name.split('.');
  return name.length <= 253 && labels.length >= 2 && labels.every((label) => HOSTNAME_LABEL.test(label));
}

/** A DNS name at `offset`, lower case and without the root dot, and where the record continues after it. */
function readName(packet: Uint8Array, offset: number): { name: string; next: number } | null {
  const labels: string[] = [];
  let position = offset;
  let next: number | null = null;
  let hops = 0;
  for (;;) {
    if (position >= packet.length) return null;
    const length = packet[position];
    if (length === 0) {
      position += 1;
      break;
    }
    if ((length & 0xc0) === 0xc0) {
      if (position + 1 >= packet.length || ++hops > MAX_NAME_POINTER_HOPS) return null;
      next ??= position + 2;
      position = ((length & 0x3f) << 8) | packet[position + 1];
      continue;
    }
    if ((length & 0xc0) !== 0) return null;
    const labelEnd = position + 1 + length;
    if (labelEnd > packet.length) return null;
    labels.push(String.fromCharCode(...packet.subarray(position + 1, labelEnd)).toLowerCase());
    position = labelEnd;
  }
  return { name: labels.join('.'), next: next ?? position };
}
