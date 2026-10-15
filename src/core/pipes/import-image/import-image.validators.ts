import { IMPORT_IMAGE_MAX_URL_LENGTH } from '@/config/import-image';

export type TImportImageUrlValidation = { ok: true; url: URL } | { ok: false; message: string };

const BLOCKED_HOSTNAME_SUFFIXES = ['.localhost', '.local', '.internal', '.onion', '.lan', '.home', '.corp'];

/**
 * Structural checks on a seller-supplied image URL. Pure: address safety
 * (DNS, private ranges) is the service's job because it needs IO.
 * https only, default port only, no embedded credentials.
 */
export class ImportImageValidators {
  private constructor() {}

  static validateUrl(raw: unknown): TImportImageUrlValidation {
    if (typeof raw !== 'string') return { ok: false, message: 'Invalid URL' };
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > IMPORT_IMAGE_MAX_URL_LENGTH) return { ok: false, message: 'Invalid URL' };

    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return { ok: false, message: 'Malformed URL' };
    }
    return this.validateParsed(url);
  }

  static validateParsed(url: URL): TImportImageUrlValidation {
    if (url.protocol !== 'https:') return { ok: false, message: 'Only https image URLs are allowed.' };
    if (url.username || url.password) return { ok: false, message: 'URLs with credentials are not allowed.' };
    if (url.port !== '' && url.port !== '443') return { ok: false, message: 'Only the default https port is allowed.' };

    const hostname = url.hostname.toLowerCase();
    if (!hostname) return { ok: false, message: 'Invalid hostname.' };
    if (hostname === 'localhost' || BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
      return { ok: false, message: 'This hostname is not allowed.' };
    }
    return { ok: true, url };
  }

  /** Clamps the client-reported remaining import budget to a usable byte count. */
  static parseRemainingBytes(raw: unknown): number | null {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
    return Math.floor(raw);
  }
}
