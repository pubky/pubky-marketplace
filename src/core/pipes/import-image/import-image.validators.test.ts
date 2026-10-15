import { describe, expect, it } from 'vitest';
import { ImportImageValidators } from './import-image.validators';

describe('ImportImageValidators.validateUrl', () => {
  it('accepts a plain https image URL', () => {
    const result = ImportImageValidators.validateUrl('  https://cdn.example.com/a/b.jpg?v=2 ');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url.hostname).toBe('cdn.example.com');
  });

  it.each([
    ['http scheme', 'http://cdn.example.com/a.jpg'],
    ['ftp scheme', 'ftp://cdn.example.com/a.jpg'],
    ['file scheme', 'file:///etc/passwd'],
    ['data scheme', 'data:image/png;base64,AAAA'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['embedded credentials', 'https://user:pass@cdn.example.com/a.jpg'],
    ['username only', 'https://user@cdn.example.com/a.jpg'],
    ['non-default port', 'https://cdn.example.com:8443/a.jpg'],
    ['localhost', 'https://localhost/a.jpg'],
    ['subdomain of localhost', 'https://app.localhost/a.jpg'],
    ['.local', 'https://printer.local/a.jpg'],
    ['.internal', 'https://metadata.google.internal/a.jpg'],
    ['.onion', 'https://abc.onion/a.jpg'],
    ['malformed', 'not a url'],
    ['empty', '   '],
    ['too long', `https://cdn.example.com/${'a'.repeat(3000)}`],
    ['non-string', 42],
    ['null', null],
  ])('rejects %s', (_name, input) => {
    expect(ImportImageValidators.validateUrl(input).ok).toBe(false);
  });

  it('allows an explicit 443 port', () => {
    expect(ImportImageValidators.validateUrl('https://cdn.example.com:443/a.jpg').ok).toBe(true);
  });
});

describe('ImportImageValidators.parseRemainingBytes', () => {
  it.each([
    [1024, 1024],
    [10.9, 10],
    [0, 0],
  ])('accepts %s', (input, expected) => {
    expect(ImportImageValidators.parseRemainingBytes(input)).toBe(expected);
  });

  it.each([[-1], [Number.NaN], [Number.POSITIVE_INFINITY], ['5'], [null], [undefined]])('ignores %s', (input) => {
    expect(ImportImageValidators.parseRemainingBytes(input)).toBeNull();
  });
});
