import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { DEFAULT_DISPLAY_PUBLIC_KEY_LENGTH, TAG_MAX_LENGTH } from '@/config/posts';
import { TAG_BANNED_CHARS } from './utils.constants';
import type {
  CopyToClipboardProps,
  ExtractInitialsProps,
  FormatPublicKeyProps,
  GetDisplayTagsOptions,
} from './utils.types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const PUBKY_PREFIX = 'pubky';
const LEGACY_PUBKY_PREFIX = 'pk:';

export function withPubkyPrefix(key: string): string {
  if (!key) return '';
  if (key.startsWith(PUBKY_PREFIX)) return key;
  if (key.startsWith(LEGACY_PUBKY_PREFIX)) {
    return `${PUBKY_PREFIX}${key.slice(LEGACY_PUBKY_PREFIX.length)}`;
  }
  return `${PUBKY_PREFIX}${key}`;
}

export function stripPubkyPrefix(key: string): string {
  if (!key) return '';
  if (key.startsWith(PUBKY_PREFIX)) return key.slice(PUBKY_PREFIX.length);
  if (key.startsWith(LEGACY_PUBKY_PREFIX)) return key.slice(LEGACY_PUBKY_PREFIX.length);
  return key;
}

export function formatPublicKey({
  key,
  length = DEFAULT_DISPLAY_PUBLIC_KEY_LENGTH,
  includePrefix = false,
}: FormatPublicKeyProps) {
  if (!key) return '';
  const rawKey = stripPubkyPrefix(key);
  const prefixLabel = includePrefix ? PUBKY_PREFIX : '';
  if (rawKey.length <= length) return `${prefixLabel}${rawKey}`;
  const prefix = rawKey.slice(0, Math.floor(length / 2));
  const suffix = rawKey.slice(-(length - prefix.length));
  return `${prefixLabel}${prefix}...${suffix}`;
}

/**
 * Checks if a string is a valid pubky identifier.
 * Pubky identifiers are exactly 52 lowercase alphanumeric characters (z-base-32 encoded).
 *
 * @param value - The string to validate
 * @returns true if the string is a valid pubky identifier
 *
 * @example
 * ```ts
 * isPubkyIdentifier('o1gg96ewuojmopcjbz8895478wdtxtzzber7aezq6ror5a91j7dy') // true
 * isPubkyIdentifier('posts') // false
 * isPubkyIdentifier('ABC123...') // false (uppercase)
 * ```
 */
export function isPubkyIdentifier(value: string): boolean {
  return /^[a-z0-9]{52}$/.test(value);
}

export async function copyToClipboard({ text }: CopyToClipboardProps) {
  if (typeof navigator === 'undefined') {
    throw new Error('Clipboard API not supported');
  }

  let clipboardError: Error | null = null;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      clipboardError = error as Error;
    }
  }

  if (typeof document === 'undefined') {
    throw clipboardError ?? new Error('Clipboard API not supported');
  }

  const execCommand = typeof document.execCommand === 'function' ? document.execCommand.bind(document) : null;

  if (!execCommand) {
    throw clipboardError ?? new Error('Clipboard API not supported');
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.opacity = '0';

  document.body.appendChild(textarea);

  try {
    textarea.focus();
    textarea.select();

    const successful = execCommand('copy');

    if (!successful) {
      throw new Error('Fallback copy command was unsuccessful');
    }
  } catch (error) {
    throw clipboardError ?? (error as Error);
  } finally {
    document.body.removeChild(textarea);
  }
}

const customCases = [
  { name: 'bitcoin', color: '#FF9900' },
  { name: 'synonym', color: '#FF6600' },
  { name: 'bitkit', color: '#FF4400' },
  { name: 'pubky', color: '#C8FF00' },
  { name: 'blocktank', color: '#FFAE00' },
  { name: 'tether', color: '#26A17B' },
];

/**
 * Generates a consistent color for a given string
 * @param str - The string to generate a color for
 * @returns Hex color string
 */
export function generateRandomColor(str: string): string {
  const lowerStr = str.toLowerCase();

  // Check for cases
  for (const special of customCases) {
    if (lowerStr === special.name) {
      return special.color;
    }
  }

  // Generate a hash value from the input string
  const hash = Array.from(str).reduce((hash, char) => {
    return char.charCodeAt(0) + ((hash << 5) - hash);
  }, 0);

  // Ensure the hash is non-negative
  const positiveHash = Math.abs(hash);

  // Convert hash to a 2-character hex value
  const randomByte = positiveHash & 0xff; // extract the lowest 8 bits
  const randomHex = randomByte.toString(16).padStart(2, '0');

  // Pick a random pattern
  const patterns = [
    `FF00${randomHex}`,
    `FF${randomHex}00`,
    `${randomHex}FF00`,
    `${randomHex}00FF`,
    `00${randomHex}FF`,
    `00FF${randomHex}`,
  ];

  // Select pattern based on the hash
  const pattern = patterns[positiveHash % patterns.length];

  return `#${pattern}`;
}

/**
 * Converts a hex color to rgba format
 * @param hex - Hex color string (e.g., '#FF9900')
 * @param alpha - Alpha value (0-1)
 * @returns RGBA color string
 */
export function hexToRgba(hex: string, alpha: number) {
  const [r, g, b] = hex.match(/\w\w/g)!.map((x) => parseInt(x, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function extractInitials({ name, maxLength = 2 }: ExtractInitialsProps) {
  if (!name || typeof name !== 'string') return '';

  return name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, maxLength);
}

/**
 * Pauses execution for the specified duration.
 * Useful for adding delays in async operations.
 *
 * @param ms - Duration to sleep in milliseconds
 * @returns Promise that resolves after the specified duration
 *
 * @example
 * await sleep(1000); // Wait 1 second
 * await sleep(5000); // Wait 5 seconds
 */
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Formats a filename by truncating it if it exceeds the max length,
 * preserving the file extension
 * @param filename - The filename to format
 * @param maxLength - Maximum length for the filename (default: 18)
 * @returns Formatted filename with ellipsis if truncated
 */
export function formatFileName(filename: string, maxLength = 18): string {
  if (filename.length <= maxLength) {
    return filename;
  }

  const extensionIndex = filename.lastIndexOf('.');
  if (extensionIndex <= 0) {
    return `${filename.slice(0, maxLength - 1)}…`;
  }

  const extension = filename.slice(extensionIndex);
  const baseLength = maxLength - extension.length - 1;

  if (baseLength <= 0) {
    return `${filename.slice(0, maxLength - 1)}…`;
  }

  return `${filename.slice(0, baseLength)}…${extension}`;
}

/**
 * Truncates a string to a maximum length and appends an ellipsis if truncated.
 * @param str - The string to truncate
 * @param maxLength - Maximum length of the string
 * @returns Truncated string with "..." at the end
 *
 * @example
 * truncateString("Short text", 20) // "Short text"
 * truncateString("Very long text that needs truncation", 20) // "Very long text that ..."
 */
export function truncateString(str: string, maxLength: number): string {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return `${str.slice(0, maxLength)}...`;
}

/**
 * Truncates a string with "..." in the middle to fit a maximum length
 * Preserves the beginning and end of the string
 *
 * @param str - The string to truncate
 * @param maxLength - Maximum length of the string
 * @returns Truncated string with "..." in the middle
 *
 * @example
 * truncateMiddle("https://example.com/short", 80) // "https://example.com/short"
 * truncateMiddle("https://example.com/very/long/path/to/page", 30) // "https://exa...to/page"
 * truncateMiddle("VeryLongFileName.pdf", 15) // "VeryLon...e.pdf"
 */
export function truncateMiddle(str: string, maxLength: number): string {
  if (!str) return '';
  if (str.length <= maxLength) return str;

  // Calculate how many chars to keep on each side
  const ellipsis = '...';
  const charsToKeep = maxLength - ellipsis.length;
  const charsStart = Math.ceil(charsToKeep / 2);
  const charsEnd = Math.floor(charsToKeep / 2);

  return str.slice(0, charsStart) + ellipsis + str.slice(-charsEnd);
}

/**
 * Decode HTML entities to their corresponding characters
 * Handles common entities like &amp;, &quot;, &#039;, etc.
 *
 * @param text - The text containing HTML entities
 * @returns Text with decoded HTML entities
 *
 * @example
 * decodeHtmlEntities("l&#039;usage") // "l'usage"
 * decodeHtmlEntities("Test &quot;quotes&quot; &amp; symbols") // 'Test "quotes" & symbols'
 */
export function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#039;': "'",
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
  };

  return text.replace(/&[#\w]+;/g, (entity) => {
    // First check named entities
    if (entities[entity]) {
      return entities[entity];
    }

    // Handle numeric entities like &#39; or &#x27;
    if (entity.startsWith('&#x')) {
      const code = parseInt(entity.slice(3, -1), 16);
      return String.fromCharCode(code);
    } else if (entity.startsWith('&#')) {
      const code = parseInt(entity.slice(2, -1), 10);
      return String.fromCharCode(code);
    }

    // If we don't recognize it, return as-is
    return entity;
  });
}

export const isPostDeleted = (content: string | undefined) => content === '[DELETED]';

/**
 * Get tags that fit within the character budget.
 * Shows fewer tags if they would exceed the total character limit.
 *
 * @param tags - Array of tag labels to filter
 * @param options - Configuration options for limiting tags
 * @returns Array of tags that fit within the constraints
 *
 * @example
 * ```ts
 * const tags = ['javascript', 'typescript', 'react', 'nodejs'];
 * getDisplayTags(tags); // ['javascript', 'typescript'] - limited by total chars
 * getDisplayTags(tags, { maxCount: 2 }); // ['javascript', 'typescript']
 * getDisplayTags(tags, { maxTotalChars: 50 }); // More tags fit
 * ```
 */
export function getDisplayTags(tags: string[], options: GetDisplayTagsOptions = {}): string[] {
  const { maxTagLength = 10, maxTotalChars = 24, maxCount = 3 } = options;

  if (tags.length === 0) return [];

  const result: string[] = [];
  let totalChars = 0;

  for (const tag of tags) {
    if (result.length >= maxCount) break;

    // Calculate effective length (truncated if needed)
    const effectiveLength = Math.min(tag.length, maxTagLength);

    // Check if adding this tag would exceed the budget
    if (totalChars + effectiveLength > maxTotalChars && result.length > 0) {
      break;
    }

    result.push(tag);
    totalChars += effectiveLength;
  }

  return result;
}

/**
 * Count characters properly (grapheme-aware)
 * Uses Array.from() to handle emojis and Unicode correctly.
 * Standard string.length counts UTF-16 code units, which makes
 * emojis like 👍 count as 2 instead of 1.
 *
 * @param text - The string to count characters in
 * @returns The number of grapheme characters
 *
 * @example
 * getCharacterCount('Hello') // 5
 * getCharacterCount('👍') // 1 (instead of 2 with .length)
 * getCharacterCount('Hello 👍') // 7
 */
export function getCharacterCount(text: string): number {
  return Array.from(text).length;
}

/**
 * Remove banned characters from tag input
 * Used to sanitize tag input on every keystroke and paste
 *
 * @param value - The raw input value
 * @returns The sanitized value with banned characters removed
 *
 * @example
 * sanitizeTagInput('hello:world') // 'helloworld'
 * sanitizeTagInput('tag, test') // 'tagtest'
 * sanitizeTagInput('valid-tag') // 'valid-tag'
 */
export function sanitizeTagInput(value: string): string {
  return value.replace(TAG_BANNED_CHARS, '');
}

/**
 * Checks whether a string is a valid tag label (correct length, no banned characters).
 *
 * @param value - The candidate tag label (should already be trimmed/lowercased)
 * @returns true when the label satisfies all tag constraints
 */
export function isValidTagLabel(value: string): boolean {
  const charCount = getCharacterCount(value);
  return charCount > 0 && charCount <= TAG_MAX_LENGTH && sanitizeTagInput(value) === value;
}

/**
 * Formats a date to US locale format (MM/DD/YYYY)
 *
 * @param date - The date to format (defaults to current date)
 * @returns Formatted date string in MM/DD/YYYY format
 *
 * @example
 * formatUSDate() // "01/15/2026" (current date)
 * formatUSDate(new Date('2024-12-25')) // "12/25/2024"
 */
export function formatUSDate(date: Date = new Date()): string {
  return date.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });
}
