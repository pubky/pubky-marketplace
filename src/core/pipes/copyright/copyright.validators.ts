import { VALIDATION_MESSAGES, VALIDATION_PATTERNS } from '@/config/forms';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import {
  COPYRIGHT_BRIEF_DESCRIPTION_MAX_LENGTH,
  COPYRIGHT_EMAIL_MAX_LENGTH,
  COPYRIGHT_ORIGINAL_CONTENT_URLS_MAX_LENGTH,
  COPYRIGHT_SHORT_FIELD_MAX_LENGTH,
  COPYRIGHT_URL_MAX_LENGTH,
} from './copyright.constants';

/**
 * Copyright input validators
 *
 * Validates and normalizes copyright/DMCA takedown request form inputs.
 * Follows the same pattern as ReportValidators.
 */
export class CopyrightValidators {
  private constructor() {}

  /**
   * Validates email format
   *
   * @param email - Email address to validate
   * @returns Normalized email (trimmed, lowercase)
   * @throws AppError if email is invalid
   */
  private static validateEmailFormat(email: string): string {
    if (!VALIDATION_PATTERNS.EMAIL.test(email)) {
      throw Err.validation(ValidationErrorCode.FORMAT_ERROR, VALIDATION_MESSAGES.INVALID_EMAIL, {
        service: ErrorService.NextJsServer,
        operation: 'validateEmailFormat',
        context: { field: 'email', value: email },
      });
    }
    return email.toLowerCase().trim();
  }

  /**
   * Validates and normalizes a required string field.
   *
   * @param value - Field value to validate
   * @param fieldName - Name of the field (for error messages)
   * @param operation - Name of the calling operation (for error context)
   * @param maxLength - Longest trimmed value accepted, in characters
   * @returns Normalized value (trimmed)
   * @throws AppError if value is missing or longer than maxLength
   */
  private static validateRequiredString(
    value: string | undefined | null,
    fieldName: string,
    operation: string,
    maxLength: number,
  ): string {
    if (!value || value.trim() === '') {
      throw Err.validation(ValidationErrorCode.MISSING_FIELD, `${fieldName} is required`, {
        service: ErrorService.NextJsServer,
        operation,
        context: { field: fieldName },
      });
    }

    const trimmed = value.trim();

    if (trimmed.length > maxLength) {
      throw Err.validation(
        ValidationErrorCode.INVALID_INPUT,
        `${fieldName} must be no more than ${maxLength} characters`,
        {
          service: ErrorService.NextJsServer,
          operation,
          context: { field: fieldName, maxLength, actualLength: trimmed.length },
        },
      );
    }

    return trimmed;
  }

  /**
   * Validates phone number format
   *
   * @param phoneNumber - Phone number to validate
   * @returns Normalized phone number (trimmed)
   * @throws AppError if phone number is invalid
   */
  private static validatePhoneNumberFormat(phoneNumber: string): string {
    if (!VALIDATION_PATTERNS.PHONE.test(phoneNumber)) {
      throw Err.validation(ValidationErrorCode.FORMAT_ERROR, VALIDATION_MESSAGES.INVALID_PHONE, {
        service: ErrorService.NextJsServer,
        operation: 'validatePhoneNumberFormat',
        context: { field: 'phoneNumber', value: phoneNumber },
      });
    }
    return phoneNumber.trim();
  }

  /**
   * Validates URL format
   *
   * @param url - URL to validate
   * @param fieldName - Name of the field (for error messages)
   * @returns Normalized URL (trimmed)
   * @throws AppError if URL is invalid
   */
  private static validateUrlFormat(url: string, fieldName: string): string {
    try {
      new URL(url);
      return url.trim();
    } catch {
      throw Err.validation(ValidationErrorCode.FORMAT_ERROR, `${fieldName} must be a valid URL`, {
        service: ErrorService.NextJsServer,
        operation: 'validateUrlFormat',
        context: { field: fieldName, value: url },
      });
    }
  }

  /**
   * Validates name of rights owner
   */
  static validateNameOwner(nameOwner: string | undefined | null): string {
    return this.validateRequiredString(
      nameOwner,
      'Name of rights owner',
      'validateNameOwner',
      COPYRIGHT_SHORT_FIELD_MAX_LENGTH,
    );
  }

  /**
   * Validates original content URLs
   */
  static validateOriginalContentUrls(originalContentUrls: string | undefined | null): string {
    return this.validateRequiredString(
      originalContentUrls,
      'Original content URLs',
      'validateOriginalContentUrls',
      COPYRIGHT_ORIGINAL_CONTENT_URLS_MAX_LENGTH,
    );
  }

  /**
   * Validates brief description
   */
  static validateBriefDescription(briefDescription: string | undefined | null): string {
    return this.validateRequiredString(
      briefDescription,
      'Brief description',
      'validateBriefDescription',
      COPYRIGHT_BRIEF_DESCRIPTION_MAX_LENGTH,
    );
  }

  /**
   * Validates infringing content URL
   */
  static validateInfringingContentUrl(infringingContentUrl: string | undefined | null): string {
    const trimmed = this.validateRequiredString(
      infringingContentUrl,
      'Infringing content URL',
      'validateInfringingContentUrl',
      COPYRIGHT_URL_MAX_LENGTH,
    );
    return this.validateUrlFormat(trimmed, 'Infringing content URL');
  }

  /**
   * Validates first name
   */
  static validateFirstName(firstName: string | undefined | null): string {
    return this.validateRequiredString(firstName, 'First name', 'validateFirstName', COPYRIGHT_SHORT_FIELD_MAX_LENGTH);
  }

  /**
   * Validates last name
   */
  static validateLastName(lastName: string | undefined | null): string {
    return this.validateRequiredString(lastName, 'Last name', 'validateLastName', COPYRIGHT_SHORT_FIELD_MAX_LENGTH);
  }

  /**
   * Validates email address
   */
  static validateEmail(email: string | undefined | null): string {
    const trimmed = this.validateRequiredString(email, 'Email', 'validateEmail', COPYRIGHT_EMAIL_MAX_LENGTH);
    return this.validateEmailFormat(trimmed);
  }

  /**
   * Validates phone number
   */
  static validatePhoneNumber(phoneNumber: string | undefined | null): string {
    const trimmed = this.validateRequiredString(
      phoneNumber,
      'Phone number',
      'validatePhoneNumber',
      COPYRIGHT_SHORT_FIELD_MAX_LENGTH,
    );
    return this.validatePhoneNumberFormat(trimmed);
  }

  /**
   * Validates street address
   */
  static validateStreetAddress(streetAddress: string | undefined | null): string {
    return this.validateRequiredString(
      streetAddress,
      'Street address',
      'validateStreetAddress',
      COPYRIGHT_SHORT_FIELD_MAX_LENGTH,
    );
  }

  /**
   * Validates country
   */
  static validateCountry(country: string | undefined | null): string {
    return this.validateRequiredString(country, 'Country', 'validateCountry', COPYRIGHT_SHORT_FIELD_MAX_LENGTH);
  }

  /**
   * Validates city
   */
  static validateCity(city: string | undefined | null): string {
    return this.validateRequiredString(city, 'City', 'validateCity', COPYRIGHT_SHORT_FIELD_MAX_LENGTH);
  }

  /**
   * Validates state/province
   */
  static validateStateProvince(stateProvince: string | undefined | null): string {
    return this.validateRequiredString(
      stateProvince,
      'State/Province',
      'validateStateProvince',
      COPYRIGHT_SHORT_FIELD_MAX_LENGTH,
    );
  }

  /**
   * Validates zip code
   */
  static validateZipCode(zipCode: string | undefined | null): string {
    return this.validateRequiredString(zipCode, 'Zip code', 'validateZipCode', COPYRIGHT_SHORT_FIELD_MAX_LENGTH);
  }

  /**
   * Validates signature
   */
  static validateSignature(signature: string | undefined | null): string {
    return this.validateRequiredString(signature, 'Signature', 'validateSignature', COPYRIGHT_SHORT_FIELD_MAX_LENGTH);
  }

  /**
   * Validates that at least one role checkbox is selected
   */
  static validateRole(
    isRightsOwner: boolean | undefined | null,
    isReportingOnBehalf: boolean | undefined | null,
  ): void {
    if (!isRightsOwner && !isReportingOnBehalf) {
      throw Err.validation(ValidationErrorCode.MISSING_FIELD, VALIDATION_MESSAGES.ROLE_REQUIRED, {
        service: ErrorService.NextJsServer,
        operation: 'validateRole',
        context: { field: 'role', isRightsOwner, isReportingOnBehalf },
      });
    }
  }
}
