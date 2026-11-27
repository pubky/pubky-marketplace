import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setSocialHost } from '@/test-utils/social-host';
import { SearchInput } from './SearchInput';

describe('SearchInput', () => {
  afterEach(() => setSocialHost(undefined));
  it.each([undefined, 'https://social.example'])('opens public search on the social host %s', (host) => {
    setSocialHost(host);
    render(<SearchInput />);
    const link = screen.getByRole('link', { name: 'Search' });
    expect(link).toHaveAttribute('href', (host ?? 'https://pubky.app') + '/search');
    expect(link).toHaveAttribute('target', '_top');
  });
});
