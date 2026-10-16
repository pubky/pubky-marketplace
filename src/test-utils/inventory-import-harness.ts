import type {
  HostImportManifest,
  HostPlannedImportRow,
  HostRowPatchResult,
  HostRowsSnapshot,
  InventoryManifestStore,
} from '@/services/marketplace/marketplace-import-store';
import type { ShopBrowserFile } from '@/services/marketplace/marketplace-shop-client';

export class MemoryImportStore implements InventoryManifestStore {
  manifests = new Map<string, HostImportManifest>();
  payloads = new Map<string, string>();
  /** Planned rows handed out by `load`, `loadRows` and the stores' own reads. */
  rowReads = 0;
  /** Planned rows written, by `create`, `compareAndSwap` or `patchRow`. */
  rowWrites = 0;

  async create(manifest: HostImportManifest): Promise<void> {
    if (this.manifests.has(manifest.manifestId)) throw new Error('manifest_conflict');
    this.manifests.set(manifest.manifestId, structuredClone(manifest));
    this.rowWrites += manifest.rows.length;
  }

  async load(manifestId: string): Promise<HostImportManifest | null> {
    const current = this.manifests.get(manifestId);
    if (!current) return null;
    this.rowReads += current.rows.length;
    return structuredClone(current);
  }

  async compareAndSwap(
    manifestId: string,
    expectedVersion: number,
    update: (manifest: HostImportManifest) => HostImportManifest,
  ): Promise<HostImportManifest> {
    const current = this.manifests.get(manifestId);
    if (!current || current.manifestVersion !== expectedVersion) throw new Error('manifest_conflict');
    this.rowReads += current.rows.length;
    const next = update(structuredClone(current));
    this.manifests.set(manifestId, next);
    this.rowWrites += next.rows.length;
    return structuredClone(next);
  }

  async loadRows(manifestId: string, rowIdentities: readonly string[]): Promise<HostRowsSnapshot | null> {
    const current = this.manifests.get(manifestId);
    if (!current) return null;
    const wanted = new Set(rowIdentities);
    const byIdentity = new Map(
      current.rows.filter((row) => wanted.has(row.rowIdentity)).map((row) => [row.rowIdentity, row]),
    );
    const rows = rowIdentities.flatMap((rowIdentity) => {
      const row = byIdentity.get(rowIdentity);
      return row ? [structuredClone(row)] : [];
    });
    this.rowReads += rows.length;
    return { manifestVersion: current.manifestVersion, rows };
  }

  async patchRow(
    manifestId: string,
    expectedVersion: number,
    rowIdentity: string,
    update: (row: HostPlannedImportRow) => HostPlannedImportRow,
  ): Promise<HostRowPatchResult> {
    const current = this.manifests.get(manifestId);
    if (!current || current.manifestVersion !== expectedVersion) throw new Error('manifest_conflict');
    const index = current.rows.findIndex((row) => row.rowIdentity === rowIdentity);
    const prior = current.rows[index];
    if (!prior) throw new Error('manifest_store_error');
    this.rowReads += 1;
    const row = update(structuredClone(prior));
    if (row.rowIdentity !== rowIdentity || row.sourceRow !== prior.sourceRow) throw new Error('manifest_store_error');
    const rows = current.rows.slice();
    rows[index] = row;
    const { rows: _rows, ...summary } = current;
    const manifestVersion = expectedVersion + 1;
    this.manifests.set(manifestId, { ...summary, manifestVersion, rows });
    this.rowWrites += 1;
    return { manifest: { ...summary, manifestVersion }, row: structuredClone(row) };
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

  async listManifests() {
    return [...this.manifests.values()]
      .map((manifest) => ({ manifestId: manifest.manifestId, createdAt: Date.parse(manifest.createdAt) || 0 }))
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  async deleteManifest(manifestId: string): Promise<void> {
    this.manifests.delete(manifestId);
    for (const key of [...this.payloads.keys()]) if (key.startsWith(`${manifestId}:`)) this.payloads.delete(key);
  }

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
