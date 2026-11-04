import { describe, expect, it } from 'vitest';
import { trustedFiatCheckoutUrl } from './fiat-checkout-url';

describe('trustedFiatCheckoutUrl', () => {
  it.each([
    'https://www.paypal.com/cgi-bin/webscr?cmd=_xclick&business=seller%40example.com',
    'https://www.sandbox.paypal.com/cgi-bin/webscr?cmd=_xclick',
    'https://www.paypal.com/checkoutnow?token=EC-ABC123',
  ])('accepts %s', (url) => {
    expect(trustedFiatCheckoutUrl(url)).toBe(url);
  });

  it('accepts the explicit default https port', () => {
    expect(trustedFiatCheckoutUrl('https://www.paypal.com:443/cgi-bin/webscr')).toBe(
      'https://www.paypal.com/cgi-bin/webscr',
    );
  });

  it.each([
    ['plain http', 'http://www.paypal.com/cgi-bin/webscr'],
    ['a host that is not PayPal', 'https://checkout.example.com/pay'],
    ['a PayPal name inside another domain', 'https://www.paypal.com.example.net/cgi-bin/webscr'],
    ['another PayPal host', 'https://paypal.com/cgi-bin/webscr'],
    ['a non-default port', 'https://www.paypal.com:8443/cgi-bin/webscr'],
    ['credentials before an attacker host', 'https://www.paypal.com@checkout.example.com/pay'],
    ['a relative path', '/marketplace/orders'],
    ['an unparseable value', 'not a url'],
    ['an empty string', ''],
  ])('refuses %s', (_case, url) => {
    expect(trustedFiatCheckoutUrl(url)).toBeNull();
  });

  it.each([null, undefined])('refuses %s', (url) => {
    expect(trustedFiatCheckoutUrl(url)).toBeNull();
  });
});
