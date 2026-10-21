import { describe, expect, it } from 'vitest';
import { USER_NAME_MAX_LENGTH } from '@/config/user';
import { AppError } from '@/libs/error/error';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import {
  REPORT_ISSUE_TYPE_VALUES,
  REPORT_ISSUE_TYPES,
  REPORT_POST_URL_MAX_LENGTH,
  REPORT_REASON_MAX_LENGTH,
  REVIEW_REPORT_ISSUE_LABELS,
  REVIEW_REPORT_ISSUE_TYPE_VALUES,
} from './report.constants';
import { ReportValidators } from './report.validators';

const VALID_PUBKY = 'o1gg96ewuojmopcjbz8895478wdtxtzzuxnfjjz8o8e77csa1ngo';

describe('ReportValidators', () => {
  describe('validatePostUrl', () => {
    it('should return trimmed postUrl for valid input', () => {
      const result = ReportValidators.validatePostUrl('  https://example.com/post/123  ');
      expect(result).toBe('https://example.com/post/123');
    });

    it('should accept valid http URL', () => {
      const result = ReportValidators.validatePostUrl('http://example.com/post/123');
      expect(result).toBe('http://example.com/post/123');
    });

    it('should throw AppError with correct properties for empty string', () => {
      try {
        ReportValidators.validatePostUrl('');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.category).toBe(ErrorCategory.Validation);
        expect(appError.code).toBe(ValidationErrorCode.MISSING_FIELD);
        expect(appError.service).toBe(ErrorService.NextJsServer);
        expect(appError.operation).toBe('validatePostUrl');
        expect(appError.context).toEqual({ field: 'postUrl' });
        expect(appError.message).toBe('Post URL is required and must be a non-empty string');
      }
    });

    it('should throw AppError for whitespace-only string', () => {
      expect(() => ReportValidators.validatePostUrl('   ')).toThrow(AppError);
    });

    it('should throw AppError for null', () => {
      expect(() => ReportValidators.validatePostUrl(null)).toThrow(AppError);
    });

    it('should throw AppError for undefined', () => {
      expect(() => ReportValidators.validatePostUrl(undefined)).toThrow(AppError);
    });

    it('should throw AppError with FORMAT_ERROR for invalid URL', () => {
      try {
        ReportValidators.validatePostUrl('not-a-valid-url');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.category).toBe(ErrorCategory.Validation);
        expect(appError.code).toBe(ValidationErrorCode.FORMAT_ERROR);
        expect(appError.service).toBe(ErrorService.NextJsServer);
        expect(appError.operation).toBe('validatePostUrl');
        expect(appError.context).toEqual({ field: 'postUrl', value: 'not-a-valid-url' });
        expect(appError.message).toBe('Post URL must be a valid URL');
      }
    });

    it('should throw AppError for URL without protocol', () => {
      expect(() => ReportValidators.validatePostUrl('example.com/post/123')).toThrow(AppError);
    });

    it('should accept post URL at max length', () => {
      const prefix = 'https://example.com/';
      const maxUrl = prefix + 'a'.repeat(REPORT_POST_URL_MAX_LENGTH - prefix.length);
      expect(ReportValidators.validatePostUrl(maxUrl)).toBe(maxUrl);
    });

    it('should throw AppError with correct properties for post URL exceeding max length', () => {
      const prefix = 'https://example.com/';
      const longUrl = prefix + 'a'.repeat(REPORT_POST_URL_MAX_LENGTH - prefix.length + 1);
      try {
        ReportValidators.validatePostUrl(longUrl);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.category).toBe(ErrorCategory.Validation);
        expect(appError.code).toBe(ValidationErrorCode.INVALID_INPUT);
        expect(appError.operation).toBe('validatePostUrl');
        expect(appError.context).toEqual({
          field: 'postUrl',
          maxLength: REPORT_POST_URL_MAX_LENGTH,
          actualLength: longUrl.length,
        });
      }
    });
  });

  describe('validateIssueType', () => {
    it('should return valid issue type for valid input', () => {
      const result = ReportValidators.validateIssueType(REPORT_ISSUE_TYPES.PERSONAL_INFO);
      expect(result).toBe(REPORT_ISSUE_TYPES.PERSONAL_INFO);
    });

    it('should accept all valid issue types', () => {
      REPORT_ISSUE_TYPE_VALUES.forEach((issueType) => {
        const result = ReportValidators.validateIssueType(issueType);
        expect(result).toBe(issueType);
      });
    });

    it('should trim whitespace from issue type', () => {
      const result = ReportValidators.validateIssueType(`  ${REPORT_ISSUE_TYPES.HATE_SPEECH}  `);
      expect(result).toBe(REPORT_ISSUE_TYPES.HATE_SPEECH);
    });

    it('should throw AppError with correct properties for empty string', () => {
      try {
        ReportValidators.validateIssueType('');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.category).toBe(ErrorCategory.Validation);
        expect(appError.code).toBe(ValidationErrorCode.MISSING_FIELD);
        expect(appError.service).toBe(ErrorService.NextJsServer);
        expect(appError.operation).toBe('validateIssueType');
        expect(appError.context).toEqual({ field: 'issueType' });
        expect(appError.message).toBe('Issue type is required and must be a non-empty string');
      }
    });

    it('should throw AppError for whitespace-only string', () => {
      expect(() => ReportValidators.validateIssueType('   ')).toThrow(AppError);
    });

    it('should throw AppError for null', () => {
      expect(() => ReportValidators.validateIssueType(null)).toThrow(AppError);
    });

    it('should throw AppError for undefined', () => {
      expect(() => ReportValidators.validateIssueType(undefined)).toThrow(AppError);
    });

    it('should throw AppError with INVALID_INPUT for invalid issue type', () => {
      try {
        ReportValidators.validateIssueType('invalid-type');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.category).toBe(ErrorCategory.Validation);
        expect(appError.code).toBe(ValidationErrorCode.INVALID_INPUT);
        expect(appError.service).toBe(ErrorService.NextJsServer);
        expect(appError.operation).toBe('validateIssueType');
        expect(appError.context).toEqual({
          field: 'issueType',
          value: 'invalid-type',
          allowedValues: REPORT_ISSUE_TYPE_VALUES,
        });
        expect(appError.message).toBe(`Invalid issue type. Must be one of: ${REPORT_ISSUE_TYPE_VALUES.join(', ')}`);
      }
    });
  });

  describe('validateReason', () => {
    it('should return trimmed reason for valid input', () => {
      const result = ReportValidators.validateReason('  This post contains harmful content  ');
      expect(result).toBe('This post contains harmful content');
    });

    it('should throw AppError with correct properties for empty string', () => {
      try {
        ReportValidators.validateReason('');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.category).toBe(ErrorCategory.Validation);
        expect(appError.code).toBe(ValidationErrorCode.MISSING_FIELD);
        expect(appError.service).toBe(ErrorService.NextJsServer);
        expect(appError.operation).toBe('validateReason');
        expect(appError.context).toEqual({ field: 'reason' });
        expect(appError.message).toBe('Reason is required and must be a non-empty string');
      }
    });

    it('should throw AppError for whitespace-only string', () => {
      expect(() => ReportValidators.validateReason('   ')).toThrow(AppError);
    });

    it('should throw AppError for null', () => {
      expect(() => ReportValidators.validateReason(null)).toThrow(AppError);
    });

    it('should throw AppError for undefined', () => {
      expect(() => ReportValidators.validateReason(undefined)).toThrow(AppError);
    });

    it('should accept reason at max length', () => {
      const maxReason = 'a'.repeat(REPORT_REASON_MAX_LENGTH);
      const result = ReportValidators.validateReason(maxReason);
      expect(result).toBe(maxReason);
    });

    it('should throw AppError with INVALID_INPUT for reason exceeding max length', () => {
      const longReason = 'a'.repeat(REPORT_REASON_MAX_LENGTH + 1);
      try {
        ReportValidators.validateReason(longReason);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.category).toBe(ErrorCategory.Validation);
        expect(appError.code).toBe(ValidationErrorCode.INVALID_INPUT);
        expect(appError.service).toBe(ErrorService.NextJsServer);
        expect(appError.operation).toBe('validateReason');
        expect(appError.context).toEqual({
          field: 'reason',
          maxLength: REPORT_REASON_MAX_LENGTH,
          actualLength: longReason.length,
        });
        expect(appError.message).toBe(`Reason must be no more than ${REPORT_REASON_MAX_LENGTH} characters`);
      }
    });

    it('should accept reason with whitespace that is within limit after trimming', () => {
      // This tests that we check trimmed length, not original length
      const reasonWithSpaces = '   ' + 'a'.repeat(REPORT_REASON_MAX_LENGTH) + '   ';
      const result = ReportValidators.validateReason(reasonWithSpaces);
      expect(result).toBe('a'.repeat(REPORT_REASON_MAX_LENGTH));
    });
  });

  describe('validatePubky', () => {
    it('should accept a 52-character z-base-32 pubky', () => {
      expect(ReportValidators.validatePubky(VALID_PUBKY)).toBe(VALID_PUBKY);
    });

    it('should trim surrounding whitespace from the pubky', () => {
      expect(ReportValidators.validatePubky(`  ${VALID_PUBKY}  `)).toBe(VALID_PUBKY);
    });

    it.each([
      ['a non-z-base-32 value', 'test-pubky'],
      ['an uppercase pubky', VALID_PUBKY.toUpperCase()],
      ['a reserved word', 'admin'],
      ['a pubky one character short', VALID_PUBKY.slice(1)],
    ])('should reject %s with FORMAT_ERROR', (_label, value) => {
      try {
        ReportValidators.validatePubky(value);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.category).toBe(ErrorCategory.Validation);
        expect(appError.code).toBe(ValidationErrorCode.FORMAT_ERROR);
        expect(appError.service).toBe(ErrorService.NextJsServer);
        expect(appError.operation).toBe('validatePubky');
        expect(appError.context).toEqual({ field: 'pubky' });
      }
    });

    it('should throw AppError with correct properties for empty string', () => {
      try {
        ReportValidators.validatePubky('');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.category).toBe(ErrorCategory.Validation);
        expect(appError.code).toBe(ValidationErrorCode.MISSING_FIELD);
        expect(appError.service).toBe(ErrorService.NextJsServer);
        expect(appError.operation).toBe('validatePubky');
        expect(appError.context).toEqual({ field: 'pubky' });
        expect(appError.message).toBe('Pubky is required and must be a non-empty string');
      }
    });

    it('should throw AppError for whitespace-only string', () => {
      expect(() => ReportValidators.validatePubky('   ')).toThrow(AppError);
    });

    it('should throw AppError for null', () => {
      expect(() => ReportValidators.validatePubky(null)).toThrow(AppError);
    });

    it('should throw AppError for undefined', () => {
      expect(() => ReportValidators.validatePubky(undefined)).toThrow(AppError);
    });
  });

  describe('validateName', () => {
    it('should return trimmed name for valid input', () => {
      const result = ReportValidators.validateName('  Test User  ');
      expect(result).toBe('Test User');
    });

    it('should throw AppError with correct properties for empty string', () => {
      try {
        ReportValidators.validateName('');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.category).toBe(ErrorCategory.Validation);
        expect(appError.code).toBe(ValidationErrorCode.MISSING_FIELD);
        expect(appError.service).toBe(ErrorService.NextJsServer);
        expect(appError.operation).toBe('validateName');
        expect(appError.context).toEqual({ field: 'name' });
        expect(appError.message).toBe('Name is required and must be a non-empty string');
      }
    });

    it('should throw AppError for whitespace-only string', () => {
      expect(() => ReportValidators.validateName('   ')).toThrow(AppError);
    });

    it('should throw AppError for null', () => {
      expect(() => ReportValidators.validateName(null)).toThrow(AppError);
    });

    it('should throw AppError for undefined', () => {
      expect(() => ReportValidators.validateName(undefined)).toThrow(AppError);
    });

    it('should accept name at max length', () => {
      const maxName = 'a'.repeat(USER_NAME_MAX_LENGTH);
      expect(ReportValidators.validateName(maxName)).toBe(maxName);
    });

    it('should throw AppError with correct properties for name exceeding max length', () => {
      const longName = 'a'.repeat(USER_NAME_MAX_LENGTH + 1);
      try {
        ReportValidators.validateName(longName);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.category).toBe(ErrorCategory.Validation);
        expect(appError.code).toBe(ValidationErrorCode.INVALID_INPUT);
        expect(appError.operation).toBe('validateName');
        expect(appError.context).toEqual({
          field: 'name',
          maxLength: USER_NAME_MAX_LENGTH,
          actualLength: longName.length,
        });
        expect(appError.message).toBe(`Name must be no more than ${USER_NAME_MAX_LENGTH} characters`);
      }
    });
  });

  describe('validateListingReference', () => {
    const SELLER = 'o1gg96ewuojmopcjbz8895478wdtxtzzuxnfjjz8o8e77csa1ngo';

    it('returns null when neither half is present, so a post report is unchanged', () => {
      expect(ReportValidators.validateListingReference(undefined, undefined)).toBeNull();
      expect(ReportValidators.validateListingReference('', '  ')).toBeNull();
      expect(ReportValidators.validateListingReference(null, null)).toBeNull();
    });

    it('returns the trimmed reference when both halves are valid', () => {
      expect(ReportValidators.validateListingReference('  boots_01 ', `  ${SELLER} `)).toEqual({
        listingId: 'boots_01',
        sellerPubky: SELLER,
      });
    });

    it.each([
      ['boots_01', undefined, 'sellerPubky'],
      [undefined, SELLER, 'listingId'],
    ])('refuses half a reference (%s, %s)', (listingId, sellerPubky, field) => {
      try {
        ReportValidators.validateListingReference(listingId, sellerPubky);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.code).toBe(ValidationErrorCode.MISSING_FIELD);
        expect(appError.operation).toBe('validateListingReference');
        expect(appError.context).toEqual({ field });
      }
    });

    it('refuses a listing id that is not path-safe', () => {
      expect(() => ReportValidators.validateListingReference('boots 01/../x', SELLER)).toThrow(
        'Listing id is not valid',
      );
    });

    it('refuses a seller pubky that is not a 52-character z-base-32 key', () => {
      expect(() => ReportValidators.validateListingReference('boots_01', 'not-a-pubky')).toThrow(
        'Seller pubky is not valid',
      );
    });
  });

  describe('review report reasons', () => {
    it('offers exactly the review reasons, in order, with their labels', () => {
      expect(REVIEW_REPORT_ISSUE_TYPE_VALUES.map((value) => REVIEW_REPORT_ISSUE_LABELS[value])).toEqual([
        'Illegal content',
        'Hate or harassment',
        'Fake or fraudulent review',
        'Personal information',
        'Other',
      ]);
    });

    it('keeps the review reasons apart from the post reasons', () => {
      for (const value of REVIEW_REPORT_ISSUE_TYPE_VALUES) {
        expect(REPORT_ISSUE_TYPE_VALUES).not.toContain(value);
      }
    });
  });

  describe('validateReviewIssueType', () => {
    it.each(REVIEW_REPORT_ISSUE_TYPE_VALUES)('accepts the review reason %s', (value) => {
      expect(ReportValidators.validateReviewIssueType(` ${value} `)).toBe(value);
    });

    it.each([REPORT_ISSUE_TYPES.ILLEGAL_SALES, 'spam', '', null, undefined])(
      'refuses %s, which is not a review reason',
      (value) => {
        try {
          ReportValidators.validateReviewIssueType(value);
          expect.fail('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(AppError);
          expect((error as AppError).code).toBe(ValidationErrorCode.INVALID_INPUT);
          expect((error as AppError).operation).toBe('validateReviewIssueType');
        }
      },
    );
  });

  describe('validateReviewReference', () => {
    const SELLER = 'o1gg96ewuojmopcjbz8895478wdtxtzzuxnfjjz8o8e77csa1ngo';
    const REVIEWER = 'a'.repeat(52);
    const REVIEW_URI = `pubky://${REVIEWER}/pub/pubky.app/marketplace/v1/reviews/8Z8CWH8NVYQY39ZEBFGKQWWEKG`;

    it('returns null without a review URI or reviewer, so post and listing reports are unchanged', () => {
      expect(ReportValidators.validateReviewReference(undefined, undefined, 'boots_01', SELLER)).toBeNull();
      expect(ReportValidators.validateReviewReference('  ', null, undefined, undefined)).toBeNull();
    });

    it('returns the trimmed reference for a canonical review URI owned by the reviewer', () => {
      expect(
        ReportValidators.validateReviewReference(` ${REVIEW_URI} `, ` ${REVIEWER} `, ' boots_01 ', SELLER),
      ).toEqual({ reviewUri: REVIEW_URI, reviewerPubky: REVIEWER, listingId: 'boots_01', sellerPubky: SELLER });
    });

    it('refuses a reviewer without the review URI', () => {
      expect(() => ReportValidators.validateReviewReference(undefined, REVIEWER, 'boots_01', SELLER)).toThrow(
        'A review report needs the review URI',
      );
    });

    it('refuses a review URI owned by someone other than the named reviewer', () => {
      expect(() => ReportValidators.validateReviewReference(REVIEW_URI, 'b'.repeat(52), 'boots_01', SELLER)).toThrow(
        "Review URI is not the reviewer's marketplace review",
      );
    });

    it.each([
      `pubky://${REVIEWER}/pub/pubky.app/posts/8Z8CWH8NVYQY39ZEBFGKQWWEKG`,
      `pubky://${REVIEWER}/pub/pubky.app/marketplace/v1/reviews/8Z8C/../x`,
      `https://example.com/pub/pubky.app/marketplace/v1/reviews/8Z8CWH8NVYQY39ZEBFGKQWWEKG`,
    ])('refuses %s, which is not a marketplace review URI', (uri) => {
      expect(() => ReportValidators.validateReviewReference(uri, REVIEWER, 'boots_01', SELLER)).toThrow(
        "Review URI is not the reviewer's marketplace review",
      );
    });

    it('refuses a malformed reviewer pubky', () => {
      expect(() => ReportValidators.validateReviewReference(REVIEW_URI, 'nope', 'boots_01', SELLER)).toThrow(
        'Reviewer pubky is not valid',
      );
    });

    it('refuses a review report without the reviewed listing', () => {
      expect(() => ReportValidators.validateReviewReference(REVIEW_URI, REVIEWER, undefined, undefined)).toThrow(
        'A review report needs the reviewed listing',
      );
    });
  });
});
