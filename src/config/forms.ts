export const DEFAULT_TEXTAREA_ROWS = 4;

/**
 * Shared validation patterns for form inputs
 */
export const VALIDATION_PATTERNS = {
  /** Email regex pattern - matches standard email format */
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  /** Phone number regex - allows digits, spaces, dashes, plus, parentheses, dots, commas, hash, star, and 'ext' */
  PHONE: /^[\d\s\-+().,#*ext]+$/i,
} as const;

/**
 * Shared validation error messages
 */
export const VALIDATION_MESSAGES = {
  INVALID_EMAIL: 'Please enter a valid email address',
  INVALID_PHONE: 'Please enter a valid phone number',
  INVALID_URL: 'Please enter a valid URL',
  ROLE_REQUIRED: 'Please select if you are the rights owner or reporting on behalf',
} as const;

/**
 * Shared label classes for controlled form fields
 */
export const FORM_LABEL_CLASSES = 'text-xs font-medium tracking-wide text-muted-foreground uppercase';

/**
 * Appended to a field label that publishing requires: a muted "Required" after the label text. CSS
 * content, so the label element's text stays the field name.
 */
export const FORM_REQUIRED_LABEL_CLASSES =
  "after:ml-1.5 after:font-normal after:normal-case after:tracking-normal after:content-['Required']";

/** Standard Pubky form field surface used by profile and marketplace forms. */
export const FORM_FIELD_SURFACE_CLASSES = '!bg-background rounded-md border border-dashed border-border font-medium';
