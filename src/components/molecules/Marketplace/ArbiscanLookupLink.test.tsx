import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ArbiscanLookupLink } from './ArbiscanLookupLink';

const HASH = `0x${'cd'.repeat(32)}`;
const ADDRESS = `0x${'ef'.repeat(20)}`;

describe('ArbiscanLookupLink', () => {
  it('opens the transaction page in a new tab without leaking the opener', () => {
    render(<ArbiscanLookupLink kind="transaction" value={HASH} />);

    const link = screen.getByRole('link', { name: 'Look up transaction on Arbiscan' });
    expect(link).toHaveAttribute('href', `https://arbiscan.io/tx/${HASH}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('opens the address page', () => {
    render(<ArbiscanLookupLink kind="address" value={ADDRESS} />);

    expect(screen.getByRole('link', { name: 'Look up address on Arbiscan' })).toHaveAttribute(
      'href',
      `https://arbiscan.io/address/${ADDRESS}`,
    );
  });

  it('renders nothing for a value that is not a well-formed hash or address', () => {
    const { container } = render(
      <>
        <ArbiscanLookupLink kind="transaction" value="REF-0001" />
        <ArbiscanLookupLink kind="address" value={HASH} />
        <ArbiscanLookupLink kind="address" value={null} />
      </>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
