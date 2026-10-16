import { afterEach, describe, expect, it } from 'vitest';
import { PaykitReceiverService, setPaykitWasmModuleForTests } from '@/services/paykit/paykit-receiver';
import { asOpaque } from '@/test-utils/type-assertions';

type Marker = { capabilities: { privatePayments: boolean; paymentRequests: boolean } };

/**
 * A purpose-built fake of the vendored binding: only the two public reads the
 * wallet check uses. Rejecting the list simulates an unreadable homeserver.
 */
function installFakeModule(world: { receivers: Map<string, Map<string, Marker>>; listFails?: boolean }) {
  class FakePubkyClient {
    static testnet() {
      return new FakePubkyClient();
    }
  }
  const fake = {
    default: async () => undefined,
    PubkyClient: FakePubkyClient,
    listPaykitReceiverPaths: async (_client: unknown, ownerPubky: string) => {
      if (world.listFails) throw new Error('homeserver unreachable');
      return [...(world.receivers.get(ownerPubky)?.keys() ?? [])];
    },
    getReceiverMarker: async (_client: unknown, ownerPubky: string, path: string) =>
      world.receivers.get(ownerPubky)?.get(path),
  };
  setPaykitWasmModuleForTests(asOpaque<typeof import('paykit-wasm')>(fake));
}

describe('PaykitReceiverService.hasPaymentRequestReceiver', () => {
  const BUYER = 'b'.repeat(52);
  const messagingOnly: Marker = { capabilities: { privatePayments: true, paymentRequests: false } };
  const bitkitWallet: Marker = { capabilities: { privatePayments: true, paymentRequests: true } };

  afterEach(() => {
    setPaykitWasmModuleForTests(null);
  });

  it('does not count a private-payments-only receiver as a payable wallet', async () => {
    installFakeModule({ receivers: new Map([[BUYER, new Map([['marketplace/wallet', messagingOnly]])]]) });
    await expect(PaykitReceiverService.hasPaymentRequestReceiver(BUYER)).resolves.toBe(false);
  });

  it('reports no wallet when nothing is published', async () => {
    installFakeModule({ receivers: new Map() });
    await expect(PaykitReceiverService.hasPaymentRequestReceiver(BUYER)).resolves.toBe(false);
  });

  it('finds a payment-request receiver next to other receivers', async () => {
    installFakeModule({
      receivers: new Map([
        [
          BUYER,
          new Map([
            ['bitkit/wallet', bitkitWallet],
            ['marketplace/wallet', messagingOnly],
          ]),
        ],
      ]),
    });
    await expect(PaykitReceiverService.hasPaymentRequestReceiver(BUYER)).resolves.toBe(true);
  });

  it('rejects when the receiver list cannot be read, never reporting "no wallet"', async () => {
    installFakeModule({ receivers: new Map(), listFails: true });
    await expect(PaykitReceiverService.hasPaymentRequestReceiver(BUYER)).rejects.toThrow();
  });
});
