import { afterEach, beforeEach, vi } from 'vitest';

/** Keep real date formatting, but make its default locale and zone deterministic. */
export function setupFixedDateLocale(locale = 'en-GB') {
  const toLocaleString = Date.prototype.toLocaleString;
  let restore = () => {};

  beforeEach(() => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(function (this: Date, locales, options) {
      return toLocaleString.call(this, locales ?? locale, {
        ...options,
        timeZone: options?.timeZone ?? 'UTC',
      });
    });
    restore = () => spy.mockRestore();
  });

  afterEach(() => restore());
}
