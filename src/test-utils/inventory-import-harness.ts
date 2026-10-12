import type { HostImportManifest, InventoryManifestStore } from '@/services/marketplace/marketplace-import-store';
import type { ShopBrowserFile } from '@/services/marketplace/marketplace-shop-client';

export class MemoryImportStore implements InventoryManifestStore {
  manifests = new Map<string, HostImportManifest>();
  payloads = new Map<string, string>();

  async create(manifest: HostImportManifest): Promise<void> {
    if (this.manifests.has(manifest.manifestId)) throw new Error('manifest_conflict');
    this.manifests.set(manifest.manifestId, structuredClone(manifest));
  }

  async load(manifestId: string): Promise<HostImportManifest | null> {
    const current = this.manifests.get(manifestId);
    return current ? structuredClone(current) : null;
  }

  async compareAndSwap(
    manifestId: string,
    expectedVersion: number,
    update: (manifest: HostImportManifest) => HostImportManifest,
  ): Promise<HostImportManifest> {
    const current = this.manifests.get(manifestId);
    if (!current || current.manifestVersion !== expectedVersion) throw new Error('manifest_conflict');
    const next = update(structuredClone(current));
    this.manifests.set(manifestId, next);
    return structuredClone(next);
  }

  async persistPayloads(manifestId: string, payloads: ReadonlyMap<string, string>): Promise<void> {
    for (const [key, value] of payloads) this.payloads.set(`${manifestId}:${key}`, value);
  }

  async getPayloadJson(manifestId: string, rowIdentity: string): Promise<string | null> {
    return this.payloads.get(`${manifestId}:${rowIdentity}`) ?? null;
  }

  async listProgress(_manifestId: string) {
    return [];
  }

  async pruneExpired(): Promise<void> {}

  async getMapping(): Promise<Record<string, string> | null> {
    return null;
  }

  async putMapping(_mapping: Record<string, string>): Promise<void> {}
}

export class BytesFile implements ShopBrowserFile {
  arrayBufferCalls = 0;

  constructor(
    private readonly bytes: Uint8Array,
    readonly name: string,
    readonly type = '',
    readonly reportedSize = bytes.byteLength,
  ) {}

  get size(): number {
    return this.reportedSize;
  }

  stream(): ReadableStream<Uint8Array> {
    const bytes = this.bytes instanceof Uint8Array ? this.bytes : new Uint8Array(this.bytes);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    Object.defineProperty(stream, Symbol.asyncIterator, {
      configurable: true,
      value: async function* () {
        yield bytes;
      },
    });
    return stream;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    this.arrayBufferCalls += 1;
    return this.bytes.slice().buffer;
  }

  slice(start = 0, end = this.bytes.byteLength): { arrayBuffer: () => Promise<ArrayBuffer> } {
    const part = this.bytes.slice(start, end);
    return {
      arrayBuffer: async () => part.slice().buffer,
    };
  }
}
