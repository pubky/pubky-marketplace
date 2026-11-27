import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerErrorCode } from '@/libs/error/error.codes';
import { ErrorCategory, ErrorService } from '@/libs/error/error.types';
import { checkDnsSafety } from './nextjs.utils';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Create stable mock references via vi.hoisted so they're shared
// between the vi.mock factories and the test assertions
const { mockResolve4, mockResolve6, mockIsIP, mockIsIpSafe } = vi.hoisted(() => ({
  mockResolve4: vi.fn<(hostname: string) => Promise<string[]>>(),
  mockResolve6: vi.fn<(hostname: string) => Promise<string[]>>(),
  mockIsIP: vi.fn<(input: string) => number>(),
  mockIsIpSafe: vi.fn<(ip: string) => boolean>(),
}));

vi.mock('dns/promises', () => ({
  default: { resolve4: mockResolve4, resolve6: mockResolve6 },
  resolve4: mockResolve4,
  resolve6: mockResolve6,
}));

vi.mock('net', () => ({
  default: { isIP: mockIsIP },
  isIP: mockIsIP,
}));

vi.mock('@/libs/network/network', () => ({
  isIpSafe: mockIsIpSafe,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXPECTED_DNS_ERROR_CODES = [
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
];

const createDnsError = (code: string) => Object.assign(new Error(code), { code });

// ---------------------------------------------------------------------------
// checkDnsSafety
// ---------------------------------------------------------------------------

describe('checkDnsSafety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsIP.mockReturnValue(0);
    mockIsIpSafe.mockReturnValue(true);
    mockResolve4.mockResolvedValue([]);
    mockResolve6.mockResolvedValue([]);
  });

  it('should resolve hostname via DNS and pass when every resolved IP is safe', async () => {
    mockResolve4.mockResolvedValueOnce(['1.2.3.4']);
    mockResolve6.mockResolvedValueOnce(['2001:4860:4860::8888']);

    await expect(checkDnsSafety('example.com')).resolves.toEqual({
      ok: true,
      addresses: [
        { address: '1.2.3.4', family: 4 },
        { address: '2001:4860:4860::8888', family: 6 },
      ],
    });
    expect(mockResolve4).toHaveBeenCalledWith('example.com');
    expect(mockResolve6).toHaveBeenCalledWith('example.com');
    expect(mockIsIpSafe).toHaveBeenCalledWith('1.2.3.4');
    expect(mockIsIpSafe).toHaveBeenCalledWith('2001:4860:4860::8888');
  });

  it('should return unsafe_ip when any resolved address is unsafe', async () => {
    mockResolve4.mockResolvedValueOnce(['1.2.3.4', '127.0.0.2']);
    mockIsIpSafe.mockImplementation((ip) => ip !== '127.0.0.2');

    await expect(checkDnsSafety('example.com')).resolves.toEqual({ ok: false, reason: 'unsafe_ip' });
    expect(mockIsIpSafe).toHaveBeenCalledWith('1.2.3.4');
    expect(mockIsIpSafe).toHaveBeenCalledWith('127.0.0.2');
  });

  it('should return unsafe_ip when an AAAA record is unsafe', async () => {
    mockResolve4.mockResolvedValueOnce(['1.2.3.4']);
    mockResolve6.mockResolvedValueOnce(['::1']);
    mockIsIpSafe.mockImplementation((ip) => ip !== '::1');

    await expect(checkDnsSafety('example.com')).resolves.toEqual({ ok: false, reason: 'unsafe_ip' });
    expect(mockIsIpSafe).toHaveBeenCalledWith('::1');
  });

  it('should skip DNS resolution when hostname is already an IP', async () => {
    mockIsIP.mockReturnValue(4);

    await expect(checkDnsSafety('1.2.3.4')).resolves.toEqual({
      ok: true,
      addresses: [{ address: '1.2.3.4', family: 4 }],
    });
    expect(mockResolve4).not.toHaveBeenCalled();
    expect(mockResolve6).not.toHaveBeenCalled();
    expect(mockIsIpSafe).toHaveBeenCalledWith('1.2.3.4');
  });

  it('should normalize bracketed IPv6 literals before safety checks', async () => {
    mockIsIP.mockImplementation((input) => (input === '2001:4860:4860::8888' ? 6 : 0));

    await expect(checkDnsSafety('[2001:4860:4860::8888]')).resolves.toEqual({
      ok: true,
      addresses: [{ address: '2001:4860:4860::8888', family: 6 }],
    });
    expect(mockResolve4).not.toHaveBeenCalled();
    expect(mockResolve6).not.toHaveBeenCalled();
    expect(mockIsIpSafe).toHaveBeenCalledWith('2001:4860:4860::8888');
  });

  it('should return dns_failed when DNS resolves to empty addresses', async () => {
    mockResolve4.mockResolvedValueOnce([]);
    mockResolve6.mockResolvedValueOnce([]);

    await expect(checkDnsSafety('empty.com')).resolves.toEqual({ ok: false, reason: 'dns_failed' });
  });

  it.each(EXPECTED_DNS_ERROR_CODES)('should return dns_failed for expected DNS error %s', async (code) => {
    const error = createDnsError(code);
    mockResolve4.mockRejectedValueOnce(error);

    await expect(checkDnsSafety('bad.com')).resolves.toEqual({
      ok: false,
      reason: 'dns_failed',
      cause: error,
    });
  });

  it('should normalize unexpected DNS resolver errors', async () => {
    const rawError = new Error('resolver bug');
    mockResolve4.mockRejectedValueOnce(rawError);

    await expect(checkDnsSafety('bad.com')).rejects.toMatchObject({
      category: ErrorCategory.Server,
      code: ServerErrorCode.UNKNOWN_ERROR,
      service: ErrorService.NextJsServer,
      operation: 'checkDnsSafety',
      cause: rawError,
      context: { hostname: 'bad.com' },
    });
  });

  it('should allow one DNS family to fail when another family resolves safely', async () => {
    mockResolve4.mockRejectedValueOnce(createDnsError('ENODATA'));
    mockResolve6.mockResolvedValueOnce(['2001:4860:4860::8888']);

    await expect(checkDnsSafety('ipv6.example.com')).resolves.toEqual({
      ok: true,
      addresses: [{ address: '2001:4860:4860::8888', family: 6 }],
    });
  });

  it('should return unsafe_ip when resolved IP is unsafe', async () => {
    mockResolve4.mockResolvedValueOnce(['127.0.0.1']);
    mockIsIpSafe.mockReturnValue(false);

    await expect(checkDnsSafety('unsafe.test')).resolves.toEqual({ ok: false, reason: 'unsafe_ip' });
  });
});
