import { z } from 'zod';

/** Unicode scalar values in `value`: what the durable service counts as a character (`str::chars().count()`). */
export function codePointLength(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

type TrimmedTextBounds = { min?: number; max: number; message?: string };

/**
 * A trimmed string bounded in code points, like the service's
 * `validate_trimmed`. `z.string().max()` counts UTF-16 code units, which
 * refuses text the service accepts (501 emoji is 1,002 units but 501 scalars,
 * so a 1,000-unit cap would refuse a 500-scalar emoji reason).
 */
export function trimmedText({ min = 0, max, message }: TrimmedTextBounds) {
  return z
    .string()
    .trim()
    .refine(
      (value) => {
        const length = codePointLength(value);
        return length >= min && length <= max;
      },
      { message: message ?? `Expected between ${min} and ${max} characters` },
    );
}

const utf8Encoder = new TextEncoder();

/** UTF-8 bytes in `value`: how the service counts a payment-review reason (`str::len()`). */
export function utf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).length;
}

/**
 * A trimmed string bounded in UTF-8 bytes. The service refuses a payment-review
 * reason over 500 bytes, so the client enforces the same bound; counting
 * UTF-16 units or code points would let 250 emoji (1,000 bytes) through.
 */
export function trimmedUtf8Text({ max, message }: { max: number; message?: string }) {
  return z
    .string()
    .trim()
    .refine((value) => utf8ByteLength(value) <= max, { message: message ?? `Expected at most ${max} bytes` });
}
