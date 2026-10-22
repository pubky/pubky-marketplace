import { USER_NAME_MAX_LENGTH } from '@/config/user';
import { commerceEntityIdSchema, commercePubkySchema } from '@/libs/commerce/transaction-contracts';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import {
  REPORT_ISSUE_TYPE_VALUES,
  REPORT_POST_URL_MAX_LENGTH,
  REPORT_REASON_MAX_LENGTH,
  REVIEW_REPORT_ISSUE_TYPE_VALUES,
} from './report.constants';
import type {
  ReportIssueType,
  ReportListingReference,
  ReportReviewReference,
  ReviewReportIssueType,
} from './report.types';

const REVIEW_URI_PATTERN = /^pubky:\/\/([^/]+)\/pub\/pubky\.app\/marketplace\/v1\/reviews\/([^/]+)$/;

/**
 * Report input validators
 *
 * Validates and normalizes report submission inputs.
 * Follows the same pattern as FeedbackValidators.
 */
export class ReportValidators {
  private constructor() {}

  /**
   * Validates and normalizes post URL input.
   *
   * @param postUrl - URL of the post being reported
   * @returns Normalized post URL (trimmed)
   * @throws AppError if postUrl is missing, too long or not a valid URL
   */
  static validatePostUrl(postUrl: string | undefined | null): string {
    if (!postUrl || postUrl.trim() === '') {
      throw Err.validation(ValidationErrorCode.MISSING_FIELD, 'Post URL is required and must be a non-empty string', {
        service: ErrorService.NextJsServer,
        operation: 'validatePostUrl',
        context: { field: 'postUrl' },
      });
    }

    const trimmedUrl = postUrl.trim();

    if (trimmedUrl.length > REPORT_POST_URL_MAX_LENGTH) {
      throw Err.validation(
        ValidationErrorCode.INVALID_INPUT,
        `Post URL must be no more than ${REPORT_POST_URL_MAX_LENGTH} characters`,
        {
          service: ErrorService.NextJsServer,
          operation: 'validatePostUrl',
          context: { field: 'postUrl', maxLength: REPORT_POST_URL_MAX_LENGTH, actualLength: trimmedUrl.length },
        },
      );
    }

    try {
      new URL(trimmedUrl);
    } catch {
      throw Err.validation(ValidationErrorCode.FORMAT_ERROR, 'Post URL must be a valid URL', {
        service: ErrorService.NextJsServer,
        operation: 'validatePostUrl',
        context: { field: 'postUrl', value: trimmedUrl },
      });
    }

    return trimmedUrl;
  }

  /**
   * Validates issue type input.
   *
   * @param issueType - Type of issue being reported
   * @returns Validated issue type
   * @throws AppError if issueType is invalid
   */
  static validateIssueType(issueType: string | undefined | null): ReportIssueType {
    if (!issueType || issueType.trim() === '') {
      throw Err.validation(ValidationErrorCode.MISSING_FIELD, 'Issue type is required and must be a non-empty string', {
        service: ErrorService.NextJsServer,
        operation: 'validateIssueType',
        context: { field: 'issueType' },
      });
    }

    const trimmedIssueType = issueType.trim();

    if (!REPORT_ISSUE_TYPE_VALUES.includes(trimmedIssueType as ReportIssueType)) {
      throw Err.validation(
        ValidationErrorCode.INVALID_INPUT,
        `Invalid issue type. Must be one of: ${REPORT_ISSUE_TYPE_VALUES.join(', ')}`,
        {
          service: ErrorService.NextJsServer,
          operation: 'validateIssueType',
          context: { field: 'issueType', value: trimmedIssueType, allowedValues: REPORT_ISSUE_TYPE_VALUES },
        },
      );
    }

    return trimmedIssueType as ReportIssueType;
  }

  /**
   * Validates and normalizes reason text input.
   *
   * @param reason - User's description of the issue
   * @returns Normalized reason (trimmed)
   * @throws AppError if reason is invalid
   */
  static validateReason(reason: string | undefined | null): string {
    if (!reason || reason.trim() === '') {
      throw Err.validation(ValidationErrorCode.MISSING_FIELD, 'Reason is required and must be a non-empty string', {
        service: ErrorService.NextJsServer,
        operation: 'validateReason',
        context: { field: 'reason' },
      });
    }

    const trimmedReason = reason.trim();

    if (trimmedReason.length > REPORT_REASON_MAX_LENGTH) {
      throw Err.validation(
        ValidationErrorCode.INVALID_INPUT,
        `Reason must be no more than ${REPORT_REASON_MAX_LENGTH} characters`,
        {
          service: ErrorService.NextJsServer,
          operation: 'validateReason',
          context: { field: 'reason', maxLength: REPORT_REASON_MAX_LENGTH, actualLength: trimmedReason.length },
        },
      );
    }

    return trimmedReason;
  }

  /**
   * Validates and normalizes pubky input.
   *
   * @param pubky - Reporter's public key
   * @returns Normalized pubky (trimmed)
   * @throws AppError if pubky is missing or not a 52-character z-base-32 key
   */
  static validatePubky(pubky: string | undefined | null): string {
    if (!pubky || pubky.trim() === '') {
      throw Err.validation(ValidationErrorCode.MISSING_FIELD, 'Pubky is required and must be a non-empty string', {
        service: ErrorService.NextJsServer,
        operation: 'validatePubky',
        context: { field: 'pubky' },
      });
    }

    const parsedPubky = commercePubkySchema.safeParse(pubky.trim());
    if (!parsedPubky.success) {
      throw Err.validation(ValidationErrorCode.FORMAT_ERROR, 'Pubky is not valid', {
        service: ErrorService.NextJsServer,
        operation: 'validatePubky',
        context: { field: 'pubky' },
      });
    }

    return parsedPubky.data;
  }

  /**
   * Validates and normalizes name input.
   *
   * @param name - Reporter's display name
   * @returns Normalized name (trimmed)
   * @throws AppError if name is missing, or is longer than USER_NAME_MAX_LENGTH code points and is not a pubky
   */
  static validateName(name: string | undefined | null): string {
    if (!name || name.trim() === '') {
      throw Err.validation(ValidationErrorCode.MISSING_FIELD, 'Name is required and must be a non-empty string', {
        service: ErrorService.NextJsServer,
        operation: 'validateName',
        context: { field: 'name' },
      });
    }

    const trimmedName = name.trim();
    // pubky-app-specs counts a name's length in Unicode code points, not UTF-16 units.
    const nameLength = [...trimmedName].length;
    // useReportPost sends the reporter's pubky as the name of a marketplace
    // report when no profile name has loaded, so a valid pubky is accepted
    // even though it is longer than a display name may be.
    const isPubkyFallback = commercePubkySchema.safeParse(trimmedName).success;

    if (nameLength > USER_NAME_MAX_LENGTH && !isPubkyFallback) {
      throw Err.validation(
        ValidationErrorCode.INVALID_INPUT,
        `Name must be no more than ${USER_NAME_MAX_LENGTH} characters`,
        {
          service: ErrorService.NextJsServer,
          operation: 'validateName',
          context: { field: 'name', maxLength: USER_NAME_MAX_LENGTH, actualLength: nameLength },
        },
      );
    }

    return trimmedName;
  }

  /**
   * Validates the optional listing reference of a listing report.
   *
   * A report either names a listing (listing id and seller pubky together) or
   * names neither. Half a reference is refused so a listing report always
   * carries what moderators need to find the listing.
   *
   * @param listingId - Seller-scoped listing id
   * @param sellerPubky - Seller's public key
   * @returns The validated reference, or null for a report about a post
   * @throws AppError if only one half is present or either half is malformed
   */
  static validateListingReference(
    listingId: string | undefined | null,
    sellerPubky: string | undefined | null,
  ): ReportListingReference | null {
    const hasListingId = typeof listingId === 'string' && listingId.trim() !== '';
    const hasSellerPubky = typeof sellerPubky === 'string' && sellerPubky.trim() !== '';
    if (!hasListingId && !hasSellerPubky) return null;

    if (!hasListingId || !hasSellerPubky) {
      throw Err.validation(
        ValidationErrorCode.MISSING_FIELD,
        'A listing report needs both the listing id and the seller pubky',
        {
          service: ErrorService.NextJsServer,
          operation: 'validateListingReference',
          context: { field: hasListingId ? 'sellerPubky' : 'listingId' },
        },
      );
    }

    const parsedListingId = commerceEntityIdSchema.safeParse(listingId.trim());
    if (!parsedListingId.success) {
      throw Err.validation(ValidationErrorCode.FORMAT_ERROR, 'Listing id is not valid', {
        service: ErrorService.NextJsServer,
        operation: 'validateListingReference',
        context: { field: 'listingId' },
      });
    }
    const parsedSellerPubky = commercePubkySchema.safeParse(sellerPubky.trim());
    if (!parsedSellerPubky.success) {
      throw Err.validation(ValidationErrorCode.FORMAT_ERROR, 'Seller pubky is not valid', {
        service: ErrorService.NextJsServer,
        operation: 'validateListingReference',
        context: { field: 'sellerPubky' },
      });
    }
    return { listingId: parsedListingId.data, sellerPubky: parsedSellerPubky.data };
  }

  /**
   * Validates review report reason input against the review reason list.
   *
   * @param issueType - Reason chosen for the review report
   * @returns Validated review reason
   * @throws AppError if the reason is missing or not a review reason
   */
  static validateReviewIssueType(issueType: string | undefined | null): ReviewReportIssueType {
    const trimmedIssueType = typeof issueType === 'string' ? issueType.trim() : '';
    if (!REVIEW_REPORT_ISSUE_TYPE_VALUES.includes(trimmedIssueType as ReviewReportIssueType)) {
      throw Err.validation(
        ValidationErrorCode.INVALID_INPUT,
        `Invalid review report reason. Must be one of: ${REVIEW_REPORT_ISSUE_TYPE_VALUES.join(', ')}`,
        {
          service: ErrorService.NextJsServer,
          operation: 'validateReviewIssueType',
          context: { field: 'issueType', value: trimmedIssueType, allowedValues: REVIEW_REPORT_ISSUE_TYPE_VALUES },
        },
      );
    }
    return trimmedIssueType as ReviewReportIssueType;
  }

  /**
   * Validates the optional review reference of a review report.
   *
   * A review report names the review URI and its reviewer, and the listing the
   * review is about. Without a review URI the report is not about a review and
   * null is returned. The URI must be the reviewer's canonical marketplace
   * review URI, so a report cannot name one author and point at another's
   * record.
   *
   * @param reviewUri - Canonical review URI (`pubky://<reviewer>/pub/pubky.app/marketplace/v1/reviews/<id>`)
   * @param reviewerPubky - The review's author
   * @param listingId - The reviewed listing's id
   * @param sellerPubky - The reviewed listing's seller
   * @returns The validated reference, or null when no review URI is present
   * @throws AppError if any part is missing or malformed, or the URI's owner is not the reviewer
   */
  static validateReviewReference(
    reviewUri: string | undefined | null,
    reviewerPubky: string | undefined | null,
    listingId: string | undefined | null,
    sellerPubky: string | undefined | null,
  ): ReportReviewReference | null {
    if (typeof reviewUri !== 'string' || reviewUri.trim() === '') {
      if (typeof reviewerPubky === 'string' && reviewerPubky.trim() !== '') {
        throw Err.validation(ValidationErrorCode.MISSING_FIELD, 'A review report needs the review URI', {
          service: ErrorService.NextJsServer,
          operation: 'validateReviewReference',
          context: { field: 'reviewUri' },
        });
      }
      return null;
    }

    const parsedReviewer = commercePubkySchema.safeParse(
      typeof reviewerPubky === 'string' ? reviewerPubky.trim() : reviewerPubky,
    );
    if (!parsedReviewer.success) {
      throw Err.validation(ValidationErrorCode.FORMAT_ERROR, 'Reviewer pubky is not valid', {
        service: ErrorService.NextJsServer,
        operation: 'validateReviewReference',
        context: { field: 'reviewerPubky' },
      });
    }

    const trimmedUri = reviewUri.trim();
    const match = REVIEW_URI_PATTERN.exec(trimmedUri);
    if (!match || match[1] !== parsedReviewer.data || !commerceEntityIdSchema.safeParse(match[2]).success) {
      throw Err.validation(ValidationErrorCode.FORMAT_ERROR, "Review URI is not the reviewer's marketplace review", {
        service: ErrorService.NextJsServer,
        operation: 'validateReviewReference',
        context: { field: 'reviewUri' },
      });
    }

    const listing = this.validateListingReference(listingId, sellerPubky);
    if (listing === null) {
      throw Err.validation(ValidationErrorCode.MISSING_FIELD, 'A review report needs the reviewed listing', {
        service: ErrorService.NextJsServer,
        operation: 'validateReviewReference',
        context: { field: 'listingId' },
      });
    }

    return { reviewUri: trimmedUri, reviewerPubky: parsedReviewer.data, ...listing };
  }
}
