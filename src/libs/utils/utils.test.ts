import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asInvalid } from '@/test-utils/type-assertions';
import {
  cn,
  copyToClipboard,
  extractInitials,
  formatPublicKey,
  generateRandomColor,
  getCharacterCount,
  getDisplayTags,
  hexToRgba,
  isPostDeleted,
  isPubkyIdentifier,
  isValidTagLabel,
  sanitizeTagInput,
  stripPubkyPrefix,
  truncateString,
} from './utils';
import { HASHTAG_IN_TEXT_REGEX, TAG_BANNED_CHARS } from './utils.constants';

describe('Utils', () => {
  describe('cn', () => {
    it('should combine multiple class names', () => {
      const result = cn('class1', 'class2', 'class3');
      expect(result).toBe('class1 class2 class3');
    });

    it('should handle conditional classes', () => {
      const result = cn('base', true && 'conditional', false && 'hidden');
      expect(result).toBe('base conditional');
    });

    it('should handle arrays of classes', () => {
      const result = cn(['class1', 'class2'], 'class3');
      expect(result).toBe('class1 class2 class3');
    });

    it('should handle objects with boolean values', () => {
      const result = cn({
        active: true,
        disabled: false,
        visible: true,
      });
      expect(result).toBe('active visible');
    });

    it('should merge conflicting Tailwind classes', () => {
      const result = cn('p-4', 'p-2');
      expect(result).toBe('p-2');
    });

    it('should handle empty inputs', () => {
      const result = cn();
      expect(result).toBe('');
    });

    it('should handle null and undefined values', () => {
      const result = cn('valid', null, undefined, 'another');
      expect(result).toBe('valid another');
    });
  });

  describe('formatPublicKey', () => {
    it('should format long keys with default length', () => {
      const longKey = 'abcdefghijklmnopqrstuvwxyz1234567890';
      const result = formatPublicKey({ key: longKey, length: 12 });
      expect(result).toBe('abcdef...567890');
    });

    it('should format long keys with custom length', () => {
      const longKey = 'abcdefghijklmnopqrstuvwxyz1234567890';
      const result = formatPublicKey({ key: longKey, length: 8 });
      expect(result).toBe('abcd...7890');
    });

    it('should return the key if shorter than or equal to length', () => {
      const shortKey = 'short';
      const result = formatPublicKey({ key: shortKey, length: 12 });
      expect(result).toBe('short');
    });

    it('should return the key if equal to length', () => {
      const exactKey = 'exactlength1';
      const result = formatPublicKey({ key: exactKey, length: 12 });
      expect(result).toBe('exactlength1');
    });

    it('should include the pubky prefix when requested', () => {
      const longKey = 'abcdefghijklmnopqrstuvwxyz1234567890';
      const result = formatPublicKey({ key: longKey, length: 12, includePrefix: true });
      expect(result).toBe('pubkyabcdef...567890');
    });

    it('should handle empty string', () => {
      const result = formatPublicKey({ key: '', length: 12 });
      expect(result).toBe('');
    });

    it('should handle very short length parameter', () => {
      const key = 'abcdefghij';
      const result = formatPublicKey({ key, length: 4 });
      expect(result).toBe('ab...ij');
    });

    it('should handle odd length parameter', () => {
      const key = 'abcdefghijklmno';
      const result = formatPublicKey({ key, length: 5 });
      expect(result).toBe('ab...mno');
    });

    it('should handle length of 1', () => {
      const key = 'abcdefghij';
      const result = formatPublicKey({ key, length: 1 });
      // With length 1, only the last character of the key is shown.
      expect(result).toBe('...j');
    });
  });

  describe('isPubkyIdentifier', () => {
    it('should return true for valid 52-char lowercase alphanumeric string', () => {
      const validPubky = 'o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy';
      expect(isPubkyIdentifier(validPubky)).toBe(true);
    });

    it('should return true for another valid pubky', () => {
      const validPubky = 'gujx6qd8ksydh1makdphd3bxu351d9b8waqka8hfg6q7hnqkxexo';
      expect(isPubkyIdentifier(validPubky)).toBe(true);
    });

    it('should return false for string shorter than 52 characters', () => {
      expect(isPubkyIdentifier('short')).toBe(false);
      expect(isPubkyIdentifier('12345678901234567890')).toBe(false); // 20 chars
      expect(isPubkyIdentifier('123456789012345678901234567890123456789012345678901')).toBe(false); // 51 chars
    });

    it('should return false for string longer than 52 characters', () => {
      expect(isPubkyIdentifier('12345678901234567890123456789012345678901234567890123')).toBe(false); // 53 chars
    });

    it('should return false for string with uppercase characters', () => {
      expect(isPubkyIdentifier('GUJX6QD8KSYDH1MAKDPHD3BXU351D9B8WAQKA8HFG6Q7HNQKXEXO')).toBe(false);
      expect(isPubkyIdentifier('gujx6qd8ksydh1makdphd3bxu351d9b8waqka8hfg6q7hnqkxexO')).toBe(false); // One uppercase
    });

    it('should return false for string with special characters', () => {
      expect(isPubkyIdentifier('gujx6qd8ksydh1makdphd3bxu351d9b8waqka8hfg6q7hnqkxex!')).toBe(false);
      expect(isPubkyIdentifier('gujx6qd8ksydh1makdphd3bxu351d9b8waqka8hfg6q7hnqkxex-')).toBe(false);
      expect(isPubkyIdentifier('gujx6qd8ksydh1makdphd3bxu351d9b8waqka8hfg6q7hnqkxex_')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isPubkyIdentifier('')).toBe(false);
    });

    it('should return false for common route names', () => {
      expect(isPubkyIdentifier('posts')).toBe(false);
      expect(isPubkyIdentifier('followers')).toBe(false);
      expect(isPubkyIdentifier('following')).toBe(false);
      expect(isPubkyIdentifier('notifications')).toBe(false);
    });
  });

  describe('copyToClipboard', () => {
    let mockClipboard: { writeText: ReturnType<typeof vi.fn> };
    let execCommandSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockClipboard = {
        writeText: vi.fn(),
      };
      execCommandSpy = vi.fn();

      Object.defineProperty(navigator, 'clipboard', {
        value: mockClipboard,
        writable: true,
      });

      Object.defineProperty(document, 'execCommand', {
        value: execCommandSpy,
        writable: true,
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should copy text to clipboard successfully', async () => {
      mockClipboard.writeText.mockResolvedValue(undefined);
      execCommandSpy.mockReturnValue(true);
      const testText = 'test text to copy';

      await copyToClipboard({ text: testText });

      expect(mockClipboard.writeText).toHaveBeenCalledWith(testText);
      expect(execCommandSpy).not.toHaveBeenCalled();
    });

    it('should handle empty string', async () => {
      mockClipboard.writeText.mockResolvedValue(undefined);
      execCommandSpy.mockReturnValue(true);

      await copyToClipboard({ text: '' });

      expect(mockClipboard.writeText).toHaveBeenCalledWith('');
      expect(execCommandSpy).not.toHaveBeenCalled();
    });

    it('should handle special characters', async () => {
      mockClipboard.writeText.mockResolvedValue(undefined);
      execCommandSpy.mockReturnValue(true);
      const specialText = 'Special chars: !@#$%^&*()_+{}[]|\\:";\'<>?,./';

      await copyToClipboard({ text: specialText });

      expect(mockClipboard.writeText).toHaveBeenCalledWith(specialText);
      expect(execCommandSpy).not.toHaveBeenCalled();
    });

    it('should fall back to execCommand when clipboard API is unavailable', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        writable: true,
      });
      execCommandSpy.mockReturnValue(true);

      await expect(copyToClipboard({ text: 'fallback text' })).resolves.toBeUndefined();

      expect(execCommandSpy).toHaveBeenCalled();
    });

    it('should fall back to execCommand when clipboard API throws', async () => {
      const clipboardError = new Error('Clipboard write failed');
      mockClipboard.writeText.mockRejectedValue(clipboardError);
      execCommandSpy.mockReturnValue(true);

      await expect(copyToClipboard({ text: 'test' })).resolves.toBeUndefined();

      expect(execCommandSpy).toHaveBeenCalled();
    });

    it('should throw error when neither clipboard nor execCommand are supported', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        writable: true,
      });
      Object.defineProperty(document, 'execCommand', {
        value: undefined,
        writable: true,
      });

      await expect(copyToClipboard({ text: 'test' })).rejects.toThrow('Clipboard API not supported');
    });

    it('should propagate execCommand errors when fallback fails', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        writable: true,
      });
      const fallbackError = new Error('Fallback copy command was unsuccessful');
      execCommandSpy.mockImplementation(() => {
        throw fallbackError;
      });

      await expect(copyToClipboard({ text: 'test' })).rejects.toThrow('Fallback copy command was unsuccessful');
    });
  });

  describe('generateRandomColor', () => {
    it('should return custom colors for specific names', () => {
      expect(generateRandomColor('bitcoin')).toBe('#FF9900');
      expect(generateRandomColor('synonym')).toBe('#FF6600');
      expect(generateRandomColor('bitkit')).toBe('#FF4400');
      expect(generateRandomColor('pubky')).toBe('#C8FF00');
      expect(generateRandomColor('blocktank')).toBe('#FFAE00');
      expect(generateRandomColor('tether')).toBe('#26A17B');
    });

    it('should return custom colors case-insensitively', () => {
      expect(generateRandomColor('BITCOIN')).toBe('#FF9900');
      expect(generateRandomColor('Bitcoin')).toBe('#FF9900');
      expect(generateRandomColor('BiTcOiN')).toBe('#FF9900');
    });

    it('should generate consistent colors for the same input', () => {
      const color1 = generateRandomColor('test');
      const color2 = generateRandomColor('test');
      expect(color1).toBe(color2);
    });

    it('should generate different colors for different inputs', () => {
      const color1 = generateRandomColor('test1');
      const color2 = generateRandomColor('test2');
      expect(color1).not.toBe(color2);
    });

    it('should return a valid hex color format', () => {
      const color = generateRandomColor('random');
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it('should handle empty string', () => {
      const color = generateRandomColor('');
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it('should handle special characters', () => {
      const color = generateRandomColor('!@#$%^&*()');
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it('should handle unicode characters', () => {
      const color = generateRandomColor('🚀🌟💫');
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });

  describe('hexToRgba', () => {
    it('should convert hex to rgba correctly', () => {
      expect(hexToRgba('#FF0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
      expect(hexToRgba('#00FF00', 1)).toBe('rgba(0, 255, 0, 1)');
      expect(hexToRgba('#0000FF', 0)).toBe('rgba(0, 0, 255, 0)');
    });

    it('should handle custom cases colors', () => {
      expect(hexToRgba('#FF9900', 0.3)).toBe('rgba(255, 153, 0, 0.3)');
      expect(hexToRgba('#26A17B', 1)).toBe('rgba(38, 161, 123, 1)');
    });

    it('should handle alpha values between 0 and 1', () => {
      expect(hexToRgba('#FFFFFF', 0.25)).toBe('rgba(255, 255, 255, 0.25)');
      expect(hexToRgba('#000000', 0.75)).toBe('rgba(0, 0, 0, 0.75)');
    });

    it('should handle edge case alpha values', () => {
      expect(hexToRgba('#123456', 0)).toBe('rgba(18, 52, 86, 0)');
      expect(hexToRgba('#123456', 1)).toBe('rgba(18, 52, 86, 1)');
    });
  });

  describe('extractInitials', () => {
    it('should extract initials from full name', () => {
      expect(extractInitials({ name: 'John Doe' })).toBe('JD');
      expect(extractInitials({ name: 'Jane Smith' })).toBe('JS');
    });

    it('should handle single name', () => {
      expect(extractInitials({ name: 'John' })).toBe('J');
      expect(extractInitials({ name: 'Jane' })).toBe('J');
    });

    it('should handle multiple names', () => {
      expect(extractInitials({ name: 'John Michael Doe' })).toBe('JM');
      expect(extractInitials({ name: 'Jane Elizabeth Smith' })).toBe('JE');
    });

    it('should respect maxLength parameter', () => {
      expect(extractInitials({ name: 'John Michael Doe', maxLength: 1 })).toBe('J');
      expect(extractInitials({ name: 'John Michael Doe', maxLength: 3 })).toBe('JMD');
      expect(extractInitials({ name: 'John Michael Doe', maxLength: 5 })).toBe('JMD');
    });

    it('should handle names with extra spaces', () => {
      expect(extractInitials({ name: '  John   Doe  ' })).toBe('JD');
      expect(extractInitials({ name: 'John   Michael   Doe' })).toBe('JM');
    });

    it('should convert to uppercase', () => {
      expect(extractInitials({ name: 'john doe' })).toBe('JD');
      expect(extractInitials({ name: 'jane smith' })).toBe('JS');
    });

    it('should handle empty string', () => {
      expect(extractInitials({ name: '' })).toBe('');
    });

    it('should handle null and undefined', () => {
      expect(extractInitials({ name: asInvalid<string>(null) })).toBe('');
      expect(extractInitials({ name: asInvalid<string>(undefined) })).toBe('');
    });

    it('should handle non-string input', () => {
      expect(extractInitials({ name: asInvalid<string>(123) })).toBe('');
      expect(extractInitials({ name: asInvalid<string>({}) })).toBe('');
    });

    it('should handle names with special characters', () => {
      expect(extractInitials({ name: 'Jean-Pierre Dupont' })).toBe('JD');
      expect(extractInitials({ name: "Mary O'Connor" })).toBe('MO');
    });

    it('should handle names with numbers', () => {
      expect(extractInitials({ name: 'John2 Doe3' })).toBe('JD');
    });
  });

  describe('truncateString', () => {
    it('should truncate strings longer than maxLength', () => {
      expect(truncateString('VeryLongUserName', 10)).toBe('VeryLongUs...');
      expect(truncateString('Jane Doe Example', 10)).toBe('Jane Doe E...');
    });

    it('should not truncate strings shorter than maxLength', () => {
      expect(truncateString('John', 10)).toBe('John');
      expect(truncateString('Short', 10)).toBe('Short');
    });

    it('should handle strings exactly at maxLength', () => {
      expect(truncateString('1234567890', 10)).toBe('1234567890');
      expect(truncateString('ExactlyTen', 10)).toBe('ExactlyTen');
    });

    it('should handle empty string', () => {
      expect(truncateString('', 10)).toBe('');
    });

    it('should handle very short maxLength', () => {
      expect(truncateString('Hello World', 1)).toBe('H...');
      expect(truncateString('Test', 2)).toBe('Te...');
    });

    it('should handle maxLength of 0', () => {
      expect(truncateString('Test', 0)).toBe('...');
    });

    it('should handle single character strings', () => {
      expect(truncateString('A', 1)).toBe('A');
      expect(truncateString('A', 5)).toBe('A');
    });

    it('should handle special characters', () => {
      expect(truncateString('Special!@#$%Characters', 10)).toBe('Special!@#...');
      expect(truncateString('Email@domain.com', 10)).toBe('Email@doma...');
    });

    it('should handle unicode characters', () => {
      // Note: Emojis are multi-byte characters, so string.length may not match visual character count
      // This test verifies the function works correctly with the JavaScript string API
      expect(truncateString('Hello 世界', 7)).toBe('Hello 世...');
      expect(truncateString('Test 你好', 6)).toBe('Test 你...');
    });

    it('should handle strings with spaces', () => {
      expect(truncateString('Hello World Test', 10)).toBe('Hello Worl...');
      expect(truncateString('   Spaces   ', 5)).toBe('   Sp...');
    });

    it('should handle null and undefined as empty strings', () => {
      expect(truncateString(asInvalid<string>(null), 10)).toBe('');
      expect(truncateString(asInvalid<string>(undefined), 10)).toBe('');
    });

    it('should add exactly three dots as ellipsis', () => {
      const result = truncateString('LongString', 5);
      expect(result.endsWith('...')).toBe(true);
      expect(result.split('...').length).toBe(2);
    });

    it('should preserve the first N characters before ellipsis', () => {
      const result = truncateString('HelloWorld', 5);
      expect(result.startsWith('Hello')).toBe(true);
      expect(result).toBe('Hello...');
    });

    it('should handle consecutive truncations consistently', () => {
      const str = 'ConsistentString';
      const result1 = truncateString(str, 8);
      const result2 = truncateString(str, 8);
      expect(result1).toBe(result2);
      expect(result1).toBe('Consiste...');
    });

    it('should handle different maxLength values for same string', () => {
      const str = 'TestString';
      expect(truncateString(str, 4)).toBe('Test...');
      expect(truncateString(str, 6)).toBe('TestSt...');
      expect(truncateString(str, 8)).toBe('TestStri...');
      expect(truncateString(str, 10)).toBe('TestString');
    });

    it('should handle numbers as strings', () => {
      expect(truncateString('123456789012345', 10)).toBe('1234567890...');
    });

    it('should handle mixed alphanumeric strings', () => {
      expect(truncateString('User123Name456', 8)).toBe('User123N...');
    });
  });

  describe('isPostDeleted', () => {
    it('should return true for "[DELETED]" content', () => {
      expect(isPostDeleted('[DELETED]')).toBe(true);
    });

    it('should return false for regular content', () => {
      expect(isPostDeleted('Hello world')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isPostDeleted('')).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isPostDeleted(undefined)).toBe(false);
    });

    it('should return false for similar but not exact match', () => {
      expect(isPostDeleted('[deleted]')).toBe(false);
      expect(isPostDeleted('DELETED')).toBe(false);
      expect(isPostDeleted('[DELETED] ')).toBe(false);
      expect(isPostDeleted(' [DELETED]')).toBe(false);
    });

    it('should return false for content containing "[DELETED]"', () => {
      expect(isPostDeleted('This post is [DELETED]')).toBe(false);
      expect(isPostDeleted('[DELETED] post')).toBe(false);
    });
  });

  describe('getCharacterCount', () => {
    it('should count ASCII characters correctly', () => {
      expect(getCharacterCount('hello')).toBe(5);
      expect(getCharacterCount('Hello World')).toBe(11);
      expect(getCharacterCount('')).toBe(0);
    });

    it('should count single emoji as 1 character', () => {
      expect(getCharacterCount('👍')).toBe(1);
      expect(getCharacterCount('🚀')).toBe(1);
      expect(getCharacterCount('❤️')).toBe(2); // Note: ❤️ is a composite emoji (heart + variation selector)
    });

    it('should count text with emojis correctly', () => {
      expect(getCharacterCount('Hello 👍')).toBe(7);
      expect(getCharacterCount('🚀🌟💫')).toBe(3);
      expect(getCharacterCount('Test 🎉 emoji')).toBe(12);
    });

    it('should count 4-byte Unicode characters correctly', () => {
      // Mathematical symbols and rare characters
      expect(getCharacterCount('𝕳𝖊𝖑𝖑𝖔')).toBe(5); // Mathematical Fraktur
      expect(getCharacterCount('𠀀')).toBe(1); // CJK extension B character
    });

    it('should count flag emojis correctly', () => {
      // Flag emojis are composed of 2 regional indicator symbols
      expect(getCharacterCount('🇺🇸')).toBe(2); // US flag = 2 regional indicators
      expect(getCharacterCount('🇧🇷')).toBe(2); // Brazil flag
    });

    it('should handle mixed content', () => {
      expect(getCharacterCount('Hello 世界 👋')).toBe(10);
      // '123 🎉 abc' = 1,2,3,space,emoji,space,a,b,c = 9 characters
      expect(getCharacterCount('123 🎉 abc')).toBe(9);
    });

    it('should count newlines and special characters', () => {
      expect(getCharacterCount('Hello\nWorld')).toBe(11);
      expect(getCharacterCount('Tab\tHere')).toBe(8);
      expect(getCharacterCount('!@#$%^&*()')).toBe(10);
    });
  });

  describe('sanitizeTagInput', () => {
    it('should remove colons from input', () => {
      expect(sanitizeTagInput('hello:world')).toBe('helloworld');
      expect(sanitizeTagInput('tag:with:colons')).toBe('tagwithcolons');
    });

    it('should remove commas from input', () => {
      expect(sanitizeTagInput('hello,world')).toBe('helloworld');
      expect(sanitizeTagInput('tag,with,commas')).toBe('tagwithcommas');
    });

    it('should remove spaces from input', () => {
      expect(sanitizeTagInput('hello world')).toBe('helloworld');
      expect(sanitizeTagInput('tag with spaces')).toBe('tagwithspaces');
    });

    it('should remove tabs and newlines from input', () => {
      expect(sanitizeTagInput('hello\tworld')).toBe('helloworld');
      expect(sanitizeTagInput('tag\nwith\rbreaks')).toBe('tagwithbreaks');
    });

    it('should remove all banned characters at once', () => {
      expect(sanitizeTagInput('hello:\t world,\n test')).toBe('helloworldtest');
      expect(sanitizeTagInput(':\n,\r mixed:\t, chars')).toBe('mixedchars');
    });

    it('should preserve valid characters', () => {
      expect(sanitizeTagInput('valid-tag')).toBe('valid-tag');
      expect(sanitizeTagInput('tag123')).toBe('tag123');
      expect(sanitizeTagInput('emoji👍tag')).toBe('emoji👍tag');
      expect(sanitizeTagInput('CamelCase')).toBe('CamelCase');
    });

    it('should handle empty string', () => {
      expect(sanitizeTagInput('')).toBe('');
    });

    it('should handle string with only banned characters', () => {
      expect(sanitizeTagInput(': , :')).toBe('');
      expect(sanitizeTagInput(' \t\r\n ')).toBe('');
    });

    it('should handle Unicode characters', () => {
      expect(sanitizeTagInput('日本語')).toBe('日本語');
      expect(sanitizeTagInput('日本語: test')).toBe('日本語test');
    });
  });

  describe('HASHTAG_IN_TEXT_REGEX', () => {
    it('matches hashtags with spec-allowed symbols', () => {
      const matches = [...'see #foo@bar here'.matchAll(HASHTAG_IN_TEXT_REGEX)].map((m) => m[2]);
      expect(matches).toEqual(['#foo@bar']);
    });

    it('stops at spec-banned comma', () => {
      const matches = [...'#hello, world'.matchAll(HASHTAG_IN_TEXT_REGEX)].map((m) => m[2]);
      expect(matches).toEqual(['#hello']);
    });

    it('does not match when hash is not preceded by whitespace', () => {
      const matches = [...'no#hashtag'.matchAll(HASHTAG_IN_TEXT_REGEX)].map((m) => m[2]);
      expect(matches).toEqual([]);
    });
  });

  describe('TAG_BANNED_CHARS', () => {
    it('should be a valid regex', () => {
      expect(TAG_BANNED_CHARS).toBeInstanceOf(RegExp);
    });

    it('should have global flag', () => {
      expect(TAG_BANNED_CHARS.global).toBe(true);
    });

    it('should match colons', () => {
      expect(':'.match(TAG_BANNED_CHARS)).not.toBeNull();
    });

    it('should match commas', () => {
      expect(','.match(TAG_BANNED_CHARS)).not.toBeNull();
    });

    it('should match spaces', () => {
      expect(' '.match(TAG_BANNED_CHARS)).not.toBeNull();
    });

    it('should match tabs and newlines', () => {
      expect('\t'.match(TAG_BANNED_CHARS)).not.toBeNull();
      expect('\n'.match(TAG_BANNED_CHARS)).not.toBeNull();
      expect('\r'.match(TAG_BANNED_CHARS)).not.toBeNull();
    });

    it('should not match valid characters', () => {
      expect('a'.match(TAG_BANNED_CHARS)).toBeNull();
      expect('-'.match(TAG_BANNED_CHARS)).toBeNull();
      expect('_'.match(TAG_BANNED_CHARS)).toBeNull();
    });
  });

  describe('isValidTagLabel', () => {
    it('should accept a short valid tag', () => {
      expect(isValidTagLabel('bitcoin')).toBe(true);
    });

    it('should accept a tag at exactly 20 characters', () => {
      expect(isValidTagLabel('a'.repeat(20))).toBe(true);
    });

    it('should reject a tag exceeding 20 characters', () => {
      expect(isValidTagLabel('a'.repeat(21))).toBe(false);
    });

    it('should reject an empty string', () => {
      expect(isValidTagLabel('')).toBe(false);
    });

    it('should reject strings containing colons', () => {
      expect(isValidTagLabel('pk:abc')).toBe(false);
      expect(isValidTagLabel('hello:world')).toBe(false);
    });

    it('should reject strings containing commas', () => {
      expect(isValidTagLabel('one,two')).toBe(false);
    });

    it('should reject strings containing spaces', () => {
      expect(isValidTagLabel('hello world')).toBe(false);
    });

    it('should reject strings containing tabs and newlines', () => {
      expect(isValidTagLabel('hello\tworld')).toBe(false);
      expect(isValidTagLabel('hello\nworld')).toBe(false);
    });

    it('should accept tags with hyphens, underscores, and unicode', () => {
      expect(isValidTagLabel('valid-tag')).toBe(true);
      expect(isValidTagLabel('valid_tag')).toBe(true);
      expect(isValidTagLabel('日本語')).toBe(true);
    });

    it('should reject a pk:-prefixed pubky string', () => {
      expect(isValidTagLabel('pk:abcdefghijklmnopqrstuvwxyz')).toBe(false);
    });
  });

  describe('stripPubkyPrefix', () => {
    it('should strip "pubky" prefix from a pubky identifier', () => {
      const prefixedKey = 'pubkyo1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy';
      const expected = 'o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy';
      expect(stripPubkyPrefix(prefixedKey)).toBe(expected);
    });

    it('should strip "pk:" legacy prefix from a pubky identifier', () => {
      const prefixedKey = 'pk:o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy';
      const expected = 'o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy';
      expect(stripPubkyPrefix(prefixedKey)).toBe(expected);
    });

    it('should return the key unchanged if no prefix is present', () => {
      const rawKey = 'o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy';
      expect(stripPubkyPrefix(rawKey)).toBe(rawKey);
    });

    it('should return empty string for empty input', () => {
      expect(stripPubkyPrefix('')).toBe('');
    });

    it('should handle null-like values gracefully', () => {
      expect(stripPubkyPrefix(asInvalid<string>(null))).toBe('');
      expect(stripPubkyPrefix(asInvalid<string>(undefined))).toBe('');
    });
  });

  describe('getDisplayTags', () => {
    it('returns an empty array for no tags', () => {
      expect(getDisplayTags([])).toEqual([]);
    });

    it('caps the number of tags at maxCount', () => {
      expect(getDisplayTags(['a', 'b', 'c', 'd'], { maxCount: 2 })).toEqual(['a', 'b']);
    });

    it('drops trailing tags that exceed the total character budget', () => {
      expect(getDisplayTags(['12345', '12345', '12345'], { maxTotalChars: 10, maxCount: 3 })).toEqual([
        '12345',
        '12345',
      ]);
    });

    it('counts over-long labels at their truncated display length (maxTagLength)', () => {
      // Each label counts as 5 chars toward the budget, not its raw 10.
      expect(getDisplayTags(['aaaaaaaaaa', 'bbbbbbbbbb'], { maxTagLength: 5, maxTotalChars: 10 })).toEqual([
        'aaaaaaaaaa',
        'bbbbbbbbbb',
      ]);
    });

    it('always keeps the first tag even when it alone exceeds the budget', () => {
      expect(getDisplayTags(['verylongtaglabel'], { maxTagLength: 20, maxTotalChars: 10 })).toEqual([
        'verylongtaglabel',
      ]);
    });
  });
});
