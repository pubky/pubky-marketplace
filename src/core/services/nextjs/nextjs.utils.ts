import { ServerErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { isIpSafe } from '@/libs/network/network';

const DNS_SAFETY_OPERATION = 'checkDnsSafety';
const IP_FAMILY_IPV4 = 4;
const IP_FAMILY_IPV6 = 6;
const EXPECTED_DNS_ERROR_CODES = new Set([
  'ENOTFOUND',
  'ESERVFAIL',
  'ETIMEDOUT',
  'ETIMEOUT',
  'EAI_AGAIN',
  'ENODATA',
  'EREFUSED',
  'ECONNREFUSED',
  'ECANCELLED',
  'EDESTRUCTION',
]);

type TDnsSafeAddress = { address: string; family: 4 | 6 };

type TDnsSafetyResult =
  | { ok: true; addresses: TDnsSafeAddress[] }
  | { ok: false; reason: 'dns_failed'; cause?: unknown }
  | { ok: false; reason: 'unsafe_ip' };

/**
 * Resolves DNS for a hostname and validates every resolved address.
 * Expected resolver failures are returned as data; unexpected failures throw an AppError.
 */
export async function checkDnsSafety(hostname: string): Promise<TDnsSafetyResult> {
  // Keep Node.js-only modules out of client bundles if this helper is imported from UI code.
  // See #1435.
  const { isIP } = await import(/* webpackIgnore: true */ 'net');
  const dns = await import(/* webpackIgnore: true */ 'dns/promises');
  const normalizedHostname = normalizeIpHostname(hostname.toLowerCase());

  const ipFamily = isIP(normalizedHostname);
  if (ipFamily === IP_FAMILY_IPV4 || ipFamily === IP_FAMILY_IPV6) {
    if (!isIpSafe(normalizedHostname)) {
      return { ok: false, reason: 'unsafe_ip' };
    }

    return { ok: true, addresses: [{ address: normalizedHostname, family: ipFamily }] };
  }

  const [ipv4Result, ipv6Result] = await Promise.allSettled([
    dns.resolve4(normalizedHostname),
    dns.resolve6(normalizedHostname),
  ]);

  const resolvedAddresses: TDnsSafeAddress[] = [];
  let dnsFailureCause: unknown;

  for (const result of [ipv4Result, ipv6Result]) {
    if (result.status === 'fulfilled') {
      resolvedAddresses.push(
        ...result.value.map(
          (address): TDnsSafeAddress => ({
            address,
            family: address.includes(':') ? IP_FAMILY_IPV6 : IP_FAMILY_IPV4,
          }),
        ),
      );
      continue;
    }

    if (isExpectedDnsResolutionError(result.reason)) {
      dnsFailureCause ??= result.reason;
      continue;
    }

    throw Err.server(ServerErrorCode.UNKNOWN_ERROR, 'DNS safety check failed', {
      service: ErrorService.NextJsServer,
      operation: DNS_SAFETY_OPERATION,
      cause: result.reason,
      context: { hostname: normalizedHostname },
    });
  }

  if (resolvedAddresses.length === 0) {
    return { ok: false, reason: 'dns_failed', cause: dnsFailureCause };
  }

  if (resolvedAddresses.some(({ address }) => !isIpSafe(address))) {
    return { ok: false, reason: 'unsafe_ip' };
  }

  return { ok: true, addresses: resolvedAddresses };
}

function isExpectedDnsResolutionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const code = 'code' in error ? error.code : undefined;
  return typeof code === 'string' && EXPECTED_DNS_ERROR_CODES.has(code);
}

function normalizeIpHostname(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }

  return hostname;
}
