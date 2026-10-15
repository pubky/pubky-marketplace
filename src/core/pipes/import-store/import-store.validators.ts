import { IMPORT_STORE_MAX_URL_LENGTH, IMPORT_STORE_PER_PAGE, IMPORT_STORE_PRODUCTS_PATH } from '@/config/import-store';
import { ImportImageValidators } from '@/pipes/import-image/import-image.validators';
import type { TImportStoreRequest } from './import-store.types';

export type TImportStoreUrlValidation = { ok: true; base: URL } | { ok: false; message: string };

export type TImportStoreRequestValidation =
  | { ok: true; request: TImportStoreRequest; url: URL }
  | { ok: false; message: string };

const BASE_PATH = /^(?:\/[A-Za-z0-9._~-]{1,64}){0,4}$/;
const MAX_PRODUCT_ID = 2 ** 31;

/**
 * Structural checks on a seller-supplied store address, and the only place a
 * Store API URL is built. The route never fetches a path the seller typed: it
 * fetches the fixed catalogue path under the store's base address. Pure:
 * address safety (DNS, private ranges) is the service's job because it needs IO.
 */
export class ImportStoreValidators {
  private constructor() {}

  /**
   * A store's base address from what a seller pastes: `myshop.com`, a full
   * https address, or a link into the shop. A link to a page of the shop gives
   * the shop's host; a link that contains `/wp-json` keeps the path before it
   * (a shop in a sub-folder). Queries and fragments are dropped. https only.
   */
  static validateStoreUrl(raw: unknown): TImportStoreUrlValidation {
    if (typeof raw !== 'string') return { ok: false, message: 'Invalid URL' };
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > IMPORT_STORE_MAX_URL_LENGTH) return { ok: false, message: 'Invalid URL' };
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
      return { ok: false, message: 'Only https store addresses are allowed.' };
    }

    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    } catch {
      return { ok: false, message: 'Malformed URL' };
    }

    const checked = ImportImageValidators.validateParsed(url);
    if (!checked.ok) return checked;

    // A shop in a sub-folder is read from its own `/wp-json` address; any other path (a product page, a category)
    // says nothing about where WordPress lives, so only the host is used.
    const cut = url.pathname.search(/\/wp-json(?:\/|$)/);
    const path = cut === -1 ? '' : url.pathname.slice(0, cut).replace(/\/+$/, '');
    if (!BASE_PATH.test(path)) return { ok: false, message: 'Unsupported store address.' };

    return { ok: true, base: new URL(`https://${url.host.toLowerCase()}${path}`) };
  }

  /** The base address as text, with no trailing slash: the form that keys everything about one store. */
  static baseText(base: URL): string {
    return `${base.origin}${base.pathname === '/' ? '' : base.pathname}`;
  }

  static pageUrl(base: URL, page: number): URL {
    return new URL(
      `${this.baseText(base)}${IMPORT_STORE_PRODUCTS_PATH}?per_page=${IMPORT_STORE_PER_PAGE}&page=${page}`,
    );
  }

  static productUrl(base: URL, productId: number): URL {
    return new URL(`${this.baseText(base)}${IMPORT_STORE_PRODUCTS_PATH}/${productId}`);
  }

  /** A route body: the store address plus exactly one of a page number or a product id. */
  static validateRequest(raw: unknown, maxPages: number): TImportStoreRequestValidation {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, message: 'Invalid request' };
    const body = raw as Record<string, unknown>;
    const store = this.validateStoreUrl(body.storeUrl);
    if (!store.ok) return store;

    if (body.kind === 'page') {
      const page = body.page;
      if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > maxPages) {
        return { ok: false, message: 'Invalid page' };
      }
      return { ok: true, request: { kind: 'page', page }, url: this.pageUrl(store.base, page) };
    }
    if (body.kind === 'product') {
      const productId = body.productId;
      if (
        typeof productId !== 'number' ||
        !Number.isInteger(productId) ||
        productId < 1 ||
        productId > MAX_PRODUCT_ID
      ) {
        return { ok: false, message: 'Invalid product' };
      }
      return { ok: true, request: { kind: 'product', productId }, url: this.productUrl(store.base, productId) };
    }
    return { ok: false, message: 'Invalid request' };
  }

  static parseRemainingBytes(raw: unknown): number | null {
    return ImportImageValidators.parseRemainingBytes(raw);
  }
}
