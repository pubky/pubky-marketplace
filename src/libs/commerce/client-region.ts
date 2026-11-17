/**
 * The country an edge header reports for a visitor. Only a plain uppercase ISO alpha-2 code
 * counts; anything else, including the "unknown" and Tor markers some edges send, means the
 * country can't be determined and is `null`.
 */
const UNKNOWN_COUNTRY_MARKERS: ReadonlySet<string> = new Set(['XX', 'T1', 'ZZ']);

export function parseClientCountry(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase();
  if (!code || !/^[A-Z]{2}$/.test(code) || UNKNOWN_COUNTRY_MARKERS.has(code)) return null;
  return code;
}
