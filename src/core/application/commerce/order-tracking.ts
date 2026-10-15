import {
  buildMarketplaceOrderAggregateId,
  type MarketplaceCommandResponse,
} from '@/libs/commerce/transaction-commands';
import { CommerceRecordNormalizer } from '@/pipes/commerce/commerce.normalizer';
import { MarketplaceGatewayService } from '@/services/marketplace/marketplace';

/**
 * `fulfillment.update_tracking`: the seller adds or corrects the carrier and
 * tracking number of a shipped order. The command changes no state; the
 * service allows it only from the seller, while the order is shipped and not
 * yet delivered.
 */
export class CommerceOrderTrackingApplication {
  private constructor() {}

  static async commitUpdateTracking(
    actorPubky: string,
    input: { orderId: string; expectedRevision: number; carrier: string; trackingNumber: string },
  ): Promise<MarketplaceCommandResponse> {
    const command = CommerceRecordNormalizer.marketplaceCommand({
      version: 1,
      commandId: crypto.randomUUID(),
      aggregateId: buildMarketplaceOrderAggregateId(input.orderId),
      expectedRevision: input.expectedRevision,
      issuedAt: new Date().toISOString(),
      kind: 'fulfillment.update_tracking',
      payload: { orderId: input.orderId, carrier: input.carrier, trackingNumber: input.trackingNumber },
    });
    return await MarketplaceGatewayService.execute(actorPubky, command);
  }
}
