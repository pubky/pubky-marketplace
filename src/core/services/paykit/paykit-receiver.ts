// Type-only imports are erased at compile time; the WASM module itself is only ever
// loaded through the dynamic import in loadPaykitWasm(), never at module scope, so this
// file stays safe to pull into server-rendered module graphs (same rule as the Locks SDK).
import type { PubkyClient } from 'paykit-wasm';
import { ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { getTestnet } from '@/libs/runtime-config/runtime-config';

type PaykitWasmModule = typeof import('paykit-wasm');

let wasmModulePromise: Promise<PaykitWasmModule> | null = null;
let moduleOverrideForTests: PaykitWasmModule | null = null;

/**
 * Loads and initializes the vendored paykit-wasm binding exactly once. The dynamic
 * import keeps the ~1.5 MB WASM binary out of every server-rendered and initial-client
 * module graph; it is only fetched when a Paykit receiver read actually runs in the
 * browser. Mirrors the Locks SDK loading pattern (locks.ts).
 */
async function loadPaykitWasm(): Promise<PaykitWasmModule> {
  if (moduleOverrideForTests) return moduleOverrideForTests;
  wasmModulePromise ??= (async () => {
    const sdk = await import('paykit-wasm');
    await sdk.default();
    return sdk;
  })();
  try {
    return await wasmModulePromise;
  } catch (error) {
    // A failed WASM fetch/instantiation must stay retryable on the next call.
    wasmModulePromise = null;
    throw error;
  }
}

/**
 * Test seam: unit tests inject the real vendored module initialized from file
 * bytes (jsdom cannot fetch the .wasm asset) or a purpose-built fake. Never
 * used in production.
 */
export function setPaykitWasmModuleForTests(wasmModule: PaykitWasmModule | null): void {
  moduleOverrideForTests = wasmModule;
  wasmModulePromise = null;
  PaykitReceiverService.resetClientForTests();
}

/**
 * Public reads of Paykit receiver markers, used by the buyer Bitcoin wallet
 * check at checkout. Needs no session.
 */
export class PaykitReceiverService {
  private static client: PubkyClient | null = null;

  /**
   * Whether `ownerPubky` publishes a Paykit receiver that takes both private
   * payments and Payment Requests — the receiver a Bitcoin checkout's payment
   * request is delivered to (a Paykit wallet such as Bitkit). Rejects when the
   * receiver list or a marker cannot be read, so a read failure is never
   * reported as "no wallet".
   */
  static async hasPaymentRequestReceiver(ownerPubky: string): Promise<boolean> {
    const wasmModule = await loadPaykitWasm();
    const client = this.getClient(wasmModule);
    const paths: unknown = await wasmModule.listPaykitReceiverPaths(client, ownerPubky);
    if (!Array.isArray(paths)) {
      throw Err.server(ServerErrorCode.UNKNOWN_ERROR, 'The Paykit receiver list could not be read.', {
        service: ErrorService.Paykit,
        operation: 'hasPaymentRequestReceiver',
      });
    }
    for (const path of paths) {
      if (typeof path !== 'string') continue;
      const marker = (await wasmModule.getReceiverMarker(client, ownerPubky, path)) as
        | { capabilities?: { privatePayments?: unknown; paymentRequests?: unknown } }
        | undefined;
      if (marker?.capabilities?.privatePayments === true && marker.capabilities.paymentRequests === true) {
        return true;
      }
    }
    return false;
  }

  static resetClientForTests(): void {
    this.client = null;
  }

  private static getClient(wasmModule: PaykitWasmModule): PubkyClient {
    this.client ??= getTestnet() ? wasmModule.PubkyClient.testnet() : new wasmModule.PubkyClient();
    return this.client;
  }
}
