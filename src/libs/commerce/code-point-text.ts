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
