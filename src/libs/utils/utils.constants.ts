import validationLimits from 'pubky-app-specs/validationLimits.json';

/**
 * Banned characters for tags per pubky-app-specs.
 * Colons, commas, spaces, tabs, and newlines are not allowed in tags.
 */
const escapeTagCharForRegex = (char: string) => {
  switch (char) {
    case '\t':
      return '\\t';
    case '\n':
      return '\\n';
    case '\r':
      return '\\r';
    default:
      return char.replace(/[\\\-\]\^]/g, '\\$&');
  }
};

const TAG_INVALID_CHARS_FOR_REGEX = validationLimits.tagInvalidChars.map(escapeTagCharForRegex).join('');

export const TAG_BANNED_CHARS = new RegExp(`[${TAG_INVALID_CHARS_FOR_REGEX}]`, 'g');

/**
 * Matches standalone hashtags in plain paragraph text (capture groups: leading whitespace, full hashtag).
 * Body allows any character except pubky-app-specs tagInvalidChars; first body char must be alphanumeric.
 * Use with isValidTagLabel before converting to a link.
 */
export const HASHTAG_IN_TEXT_REGEX = new RegExp(`(^|\\s)(#[a-zA-Z0-9][^${TAG_INVALID_CHARS_FOR_REGEX}]*)`, 'g');
