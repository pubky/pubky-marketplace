/** @vitest-environment node */
import { ed25519 } from '@noble/curves/ed25519.js';
import { Keypair, PublicKey } from '@synonymdev/pubky';
import { describe, expect, it, vi } from 'vitest';
import {
  type HomeserverEndpointDeps,
  httpsOriginFromPacket,
  resolveHomeserverHttpsOrigin,
  verifySignedPacket,
} from './homeserver-endpoint';

/** The staging homeserver's record as a Pkarr relay served it (signature, timestamp, DNS packet). */
const STAGING_HOMESERVER = 'ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy';
const STAGING_RELAY_ANSWER = Buffer.from(
  'k/Z4zRpBjfcyugGCortScui3rgoR/6HLw+oRXqxLdCMpr0QELmYYthFrIzkXrQFSrJVxDvP5EuHsVNRk8N4SCAAGYDalEit9AACAAAAAAAMAAAAANHVmaWJ3Ym1lZDZqZXE5azRwNTgzZ285NXdvZmFraDlmd3BwNGs3MzR0cnE3OXBkOXUxdXkAAEEAAQAADhAAEQABAAADAAIYjwAEAAQiQedRwAwAQQABAAAOEAAgAAoKaG9tZXNlcnZlcgdzdGFnaW5nBXB1Ymt5A2FwcADADAABAAEAAA4QAAQiQedR',
  'base64',
);

type ServiceRecord = { owner?: string; type?: number; priority: number; target: string; params?: [number, number[]][] };

function encodeName(name: string): number[] {
  if (name === '') return [0];
  return [...name.split('.').flatMap((label) => [label.length, ...Buffer.from(label, 'ascii')]), 0];
}

function u16(value: number): number[] {
  return [value >> 8, value & 0xff];
}

function dnsPacket(z32: string, records: ServiceRecord[]): Uint8Array {
  const bytes = [...u16(0), ...u16(0x8000), ...u16(0), ...u16(records.length), ...u16(0), ...u16(0)];
  for (const record of records) {
    const params = (record.params ?? []).flatMap(([key, value]) => [...u16(key), ...u16(value.length), ...value]);
    const data = [...u16(record.priority), ...encodeName(record.target), ...params];
    bytes.push(...encodeName(record.owner ?? z32), ...u16(record.type ?? 65), ...u16(1), 0, 0, 0x0e, 0x10);
    bytes.push(...u16(data.length), ...data);
  }
  return new Uint8Array(bytes);
}

function signedAnswer(
  keypair: Keypair,
  packet: Uint8Array,
  timestamp = BigInt(1_760_000_000_000_000),
): Uint8Array<ArrayBuffer> {
  const prefix = new TextEncoder().encode(`3:seqi${timestamp}e1:v${packet.length}:`);
  const signature = ed25519.sign(new Uint8Array([...prefix, ...packet]), keypair.secret());
  const time = new Uint8Array(8);
  new DataView(time.buffer).setBigUint64(0, timestamp);
  return new Uint8Array([...signature, ...time, ...packet]);
}

function relayDeps(answers: Record<string, Uint8Array<ArrayBuffer> | number | Error>): HomeserverEndpointDeps {
  return {
    relays: Object.keys(answers),
    timeoutMs: 1000,
    fetchRelay: vi.fn(async (url: URL) => {
      const answer = answers[url.origin];
      if (answer instanceof Error) throw answer;
      if (typeof answer === 'number') return new Response(null, { status: answer });
      return new Response(answer, { status: 200 });
    }),
  };
}

describe('homeserver endpoint from Pkarr', () => {
  it('verifies a real relay answer and reads its HTTPS hostname', () => {
    const verified = verifySignedPacket(
      new Uint8Array(STAGING_RELAY_ANSWER),
      PublicKey.from(STAGING_HOMESERVER).toUint8Array(),
    );
    expect(verified).not.toBeNull();
    expect(httpsOriginFromPacket(verified!.packet, STAGING_HOMESERVER)).toBe('https://homeserver.staging.pubky.app');
  });

  it('refuses a tampered packet and a packet signed by another key', () => {
    const tampered = new Uint8Array(STAGING_RELAY_ANSWER);
    tampered[tampered.length - 20] ^= 1;
    expect(verifySignedPacket(tampered, PublicKey.from(STAGING_HOMESERVER).toUint8Array())).toBeNull();
    expect(
      verifySignedPacket(new Uint8Array(STAGING_RELAY_ANSWER), Keypair.random().publicKey.toUint8Array()),
    ).toBeNull();
    expect(verifySignedPacket(new Uint8Array(40), PublicKey.from(STAGING_HOMESERVER).toUint8Array())).toBeNull();
  });

  it('resolves the origin from the relays, newest verified record first', async () => {
    const homeserver = Keypair.random();
    const z32 = homeserver.publicKey.z32();
    const older = signedAnswer(homeserver, dnsPacket(z32, [{ priority: 1, target: 'old.example.com' }]), BigInt(1));
    const newer = signedAnswer(homeserver, dnsPacket(z32, [{ priority: 1, target: 'new.example.com' }]), BigInt(2));
    const deps = relayDeps({ 'https://relay-a.example': older, 'https://relay-b.example': newer });
    await expect(resolveHomeserverHttpsOrigin(z32, deps)).resolves.toBe('https://new.example.com');
    expect(deps.fetchRelay).toHaveBeenCalledWith(
      new URL(`https://relay-a.example/${z32}`),
      expect.objectContaining({ redirect: 'error', cache: 'no-store' }),
    );
  });

  it("ignores a newer record signed by another key, so a relay cannot swap the homeserver's host", async () => {
    const homeserver = Keypair.random();
    const forger = Keypair.random();
    const z32 = homeserver.publicKey.z32();
    const genuine = signedAnswer(homeserver, dnsPacket(z32, [{ priority: 1, target: 'hs.example.com' }]), BigInt(1));
    const forged = signedAnswer(forger, dnsPacket(z32, [{ priority: 1, target: 'attacker.example' }]), BigInt(9));
    const deps = relayDeps({ 'https://relay-a.example': genuine, 'https://relay-b.example': forged });
    await expect(resolveHomeserverHttpsOrigin(z32, deps)).resolves.toBe('https://hs.example.com');
  });

  it('returns null when no relay answers with a verified record', async () => {
    const z32 = Keypair.random().publicKey.z32();
    const forged = signedAnswer(Keypair.random(), dnsPacket(z32, [{ priority: 1, target: 'hs.example.com' }]));
    const deps = relayDeps({
      'https://relay-a.example': 404,
      'https://relay-b.example': new Error('offline'),
      'https://relay-c.example': forged,
      'https://relay-d.example': new Uint8Array(2000),
    });
    await expect(resolveHomeserverHttpsOrigin(z32, deps)).resolves.toBeNull();
    await expect(resolveHomeserverHttpsOrigin('not-a-key', deps)).resolves.toBeNull();
  });

  it("stops reading a relay's endless answer at the record size and cancels it", async () => {
    let pulledBytes = 0;
    let cancelled = false;
    const deps: HomeserverEndpointDeps = {
      relays: ['https://relay-a.example'],
      timeoutMs: 1000,
      fetchRelay: async () =>
        new Response(
          new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                pulledBytes += 256;
                controller.enqueue(new Uint8Array(256));
              },
              cancel() {
                cancelled = true;
              },
            },
            { highWaterMark: 0 },
          ),
          { status: 200, headers: { 'content-length': '100' } },
        ),
    };

    await expect(resolveHomeserverHttpsOrigin(Keypair.random().publicKey.z32(), deps)).resolves.toBeNull();

    expect(pulledBytes).toBeLessThanOrEqual(1072 + 256);
    expect(cancelled).toBe(true);
  });

  it('picks the lowest-priority usable service record', () => {
    const z32 = Keypair.random().publicKey.z32();
    const packet = dnsPacket(z32, [
      { priority: 20, target: 'backup.example.com' },
      { priority: 5, target: 'primary.example.com', params: [[3, [0x01, 0xbb]]] },
      { priority: 1, target: '', params: [[3, [0x18, 0x8f]]] },
    ]);
    expect(httpsOriginFromPacket(packet, z32)).toBe('https://primary.example.com');
  });

  it.each<[string, ServiceRecord]>([
    ['an IP-only endpoint', { priority: 1, target: '' }],
    ['another Pkarr key', { priority: 1, target: 'ybndrfg8ejkmcpqxot1uwisza345h769ybndrfg8ejkmcpqxot1u' }],
    ['a single-label host', { priority: 1, target: 'localhost' }],
    ['a port other than 443', { priority: 1, target: 'hs.example.com', params: [[3, [0x18, 0x8e]]] }],
    ['an alias record', { priority: 0, target: 'hs.example.com' }],
    ['a record of another name', { owner: 'other.example', priority: 1, target: 'hs.example.com' }],
    ['a record of another type', { type: 1, priority: 1, target: 'hs.example.com' }],
    ['a host with an invalid label', { priority: 1, target: 'hs_1.example.com' }],
  ])('offers no endpoint for %s', (_label, record) => {
    const z32 = Keypair.random().publicKey.z32();
    expect(httpsOriginFromPacket(dnsPacket(z32, [record]), z32)).toBeNull();
  });

  it('refuses a truncated or looping packet', () => {
    const z32 = Keypair.random().publicKey.z32();
    const packet = dnsPacket(z32, [{ priority: 1, target: 'hs.example.com' }]);
    expect(httpsOriginFromPacket(packet.subarray(0, packet.length - 3), z32)).toBeNull();
    const loop = new Uint8Array([0, 0, 0x80, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0xc0, 12]);
    expect(httpsOriginFromPacket(loop, z32)).toBeNull();
  });
});
