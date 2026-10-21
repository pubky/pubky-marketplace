import { describe, expect, it } from 'vitest';
import { FEEDBACK_MAX_CHARACTER_LENGTH } from '@/config/posts';
import { USER_NAME_MAX_LENGTH } from '@/config/user';
import { AppError } from '@/libs/error/error';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { FeedbackValidators } from './feedback.validators';

const VALID_PUBKY = 'o1gg96ewuojmopcjbz8895478wdtxtzzuxnfjjz8o8e77csa1ngo';

describe('FeedbackValidators', () => {
  describe('validatePubky', () => {
    it('should accept a 52-character z-base-32 pubky', () => {
      expect(FeedbackValidators.validatePubky(VALID_PUBKY)).toBe(VALID_PUBKY);
    });

    it('should trim surrounding whitespace from the pubky', () => {
      expect(FeedbackValidators.validatePubky(`  ${VALID_PUBKY}  `)).toBe(VALID_PUBKY);
    });

    it.each([
      ['a non-z-base-32 value', 'test-pubky'],
      ['an uppercase pubky', VALID_PUBKY.toUpperCase()],
      ['a reserved word', 'admin'],
      ['a pubky one character short', VALID_PUBKY.slice(1)],
    ])('should reject %s with FORMAT_ERROR', (_label, value) => {
      try {
        FeedbackValidators.validatePubky(value);
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
        FeedbackValidators.validatePubky('');
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
      expect(() => FeedbackValidators.validatePubky('   ')).toThrow(AppError);
    });

    it('should throw AppError for null', () => {
      expect(() => FeedbackValidators.validatePubky(null)).toThrow(AppError);
    });

    it('should throw AppError for undefined', () => {
      expect(() => FeedbackValidators.validatePubky(undefined)).toThrow(AppError);
    });
  });

  describe('validateComment', () => {
    it('should return trimmed comment for valid input', () => {
      const result = FeedbackValidators.validateComment('  test comment  ');
      expect(result).toBe('test comment');
    });

    it('should throw AppError with correct properties for empty string', () => {
      try {
        FeedbackValidators.validateComment('');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.category).toBe(ErrorCategory.Validation);
        expect(appError.code).toBe(ValidationErrorCode.MISSING_FIELD);
        expect(appError.service).toBe(ErrorService.NextJsServer);
        expect(appError.operation).toBe('validateComment');
        expect(appError.context).toEqual({ field: 'comment' });
        expect(appError.message).toBe('Comment is required and must be a non-empty string');
      }
    });

    it('should throw AppError for whitespace-only string', () => {
      expect(() => FeedbackValidators.validateComment('   ')).toThrow(AppError);
    });

    it('should throw AppError for null', () => {
      expect(() => FeedbackValidators.validateComment(null)).toThrow(AppError);
    });

    it('should throw AppError for undefined', () => {
      expect(() => FeedbackValidators.validateComment(undefined)).toThrow(AppError);
    });

    it('should accept comment at max length', () => {
      const maxComment = 'a'.repeat(FEEDBACK_MAX_CHARACTER_LENGTH);
      const result = FeedbackValidators.validateComment(maxComment);
      expect(result).toBe(maxComment);
    });

    it('should throw AppError with correct properties for comment exceeding max length', () => {
      const longComment = 'a'.repeat(FEEDBACK_MAX_CHARACTER_LENGTH + 1);
      try {
        FeedbackValidators.validateComment(longComment);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const appError = error as AppError;
        expect(appError.category).toBe(ErrorCategory.Validation);
        expect(appError.code).toBe(ValidationErrorCode.INVALID_INPUT);
        expect(appError.service).toBe(ErrorService.NextJsServer);
        expect(appError.operation).toBe('validateComment');
        expect(appError.context).toEqual({
          field: 'comment',
          maxLength: FEEDBACK_MAX_CHARACTER_LENGTH,
          actualLength: longComment.length,
        });
        expect(appError.message).toBe(`Comment must be no more than ${FEEDBACK_MAX_CHARACTER_LENGTH} characters`);
      }
    });
  });

  describe('validateName', () => {
    it('should return trimmed name for valid input', () => {
      const result = FeedbackValidators.validateName('  Test User  ');
      expect(result).toBe('Test User');
    });

    it('should throw AppError with correct properties for empty string', () => {
      try {
        FeedbackValidators.validateName('');
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
      expect(() => FeedbackValidators.validateName('   ')).toThrow(AppError);
    });

    it('should throw AppError for null', () => {
      expect(() => FeedbackValidators.validateName(null)).toThrow(AppError);
    });

    it('should throw AppError for undefined', () => {
      expect(() => FeedbackValidators.validateName(undefined)).toThrow(AppError);
    });

    it('should accept name at max length', () => {
      const maxName = 'a'.repeat(USER_NAME_MAX_LENGTH);
      expect(FeedbackValidators.validateName(maxName)).toBe(maxName);
    });

    it('should throw AppError with correct properties for name exceeding max length', () => {
      const longName = 'a'.repeat(USER_NAME_MAX_LENGTH + 1);
      try {
        FeedbackValidators.validateName(longName);
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
});
