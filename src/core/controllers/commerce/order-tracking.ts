import { CommerceOrderTrackingApplication } from '@/application/commerce/order-tracking';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { CommerceRecordNormalizer } from '@/pipes/commerce/commerce.normalizer';
import { useAuthStore } from '@/stores/auth/auth.store';

export class CommerceOrderTrackingController {
  private constructor() {}

  /** `fulfillment.update_tracking`: the current seller adds or corrects the carrier and tracking number of a shipped order. */
  static async commitUpdateOrderTracking(
    orderId: unknown,
    expectedRevision: unknown,
    carrier: unknown,
    trackingNumber: unknown,
  ) {
    return await CommerceOrderTrackingApplication.commitUpdateTracking(
      useAuthStore.getState().selectCurrentUserPubky(),
      {
        orderId: CommerceRecordNormalizer.entityId(orderId),
        expectedRevision: this.revision(expectedRevision),
        carrier: this.text(carrier, 'A carrier is required.'),
        trackingNumber: this.text(trackingNumber, 'A tracking number is required.'),
      },
    );
  }

  private static revision(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'A non-negative order revision is required.', {
        service: ErrorService.Marketplace,
        operation: 'commitUpdateOrderTracking',
      });
    }
    return value;
  }

  private static text(value: unknown, message: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, message, {
        service: ErrorService.Marketplace,
        operation: 'commitUpdateOrderTracking',
      });
    }
    return value.trim();
  }
}
