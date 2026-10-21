import { FEEDBACK_MAX_CHARACTER_LENGTH } from '@/config/posts';
import { USER_NAME_MAX_LENGTH } from '@/config/user';
import { commercePubkySchema } from '@/libs/commerce/transaction-contracts';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import type { Pubky } from '@/models/models.types';

export class FeedbackValidators {
  private constructor() {}

  /**
   * Validates and normalizes pubky input.
   * Throws an error if validation fails.
   *
   * @param pubky - User's public key to validate
   * @returns Normalized pubky (trimmed)
   * @throws AppError if pubky is missing or not a 52-character z-base-32 key
   */
  static validatePubky(pubky: string | undefined | null): Pubky {
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

    return parsedPubky.data as Pubky;
  }

  /**
   * Validates and normalizes comment input.
   * Throws an error if validation fails.
   *
   * @param comment - Feedback comment to validate
   * @returns Normalized comment (trimmed)
   * @throws AppError if comment is invalid
   */
  static validateComment(comment: string | undefined | null): string {
    if (!comment || comment.trim() === '') {
      throw Err.validation(ValidationErrorCode.MISSING_FIELD, 'Comment is required and must be a non-empty string', {
        service: ErrorService.NextJsServer,
        operation: 'validateComment',
        context: { field: 'comment' },
      });
    }

    if (comment.length > FEEDBACK_MAX_CHARACTER_LENGTH) {
      throw Err.validation(
        ValidationErrorCode.INVALID_INPUT,
        `Comment must be no more than ${FEEDBACK_MAX_CHARACTER_LENGTH} characters`,
        {
          service: ErrorService.NextJsServer,
          operation: 'validateComment',
          context: { field: 'comment', maxLength: FEEDBACK_MAX_CHARACTER_LENGTH, actualLength: comment.length },
        },
      );
    }

    return comment.trim();
  }

  /**
   * Validates and normalizes name input.
   * Throws an error if validation fails.
   *
   * @param name - User's display name to validate
   * @returns Normalized name (trimmed)
   * @throws AppError if name is missing or longer than USER_NAME_MAX_LENGTH
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

    if (trimmedName.length > USER_NAME_MAX_LENGTH) {
      throw Err.validation(
        ValidationErrorCode.INVALID_INPUT,
        `Name must be no more than ${USER_NAME_MAX_LENGTH} characters`,
        {
          service: ErrorService.NextJsServer,
          operation: 'validateName',
          context: { field: 'name', maxLength: USER_NAME_MAX_LENGTH, actualLength: trimmedName.length },
        },
      );
    }

    return trimmedName;
  }
}
