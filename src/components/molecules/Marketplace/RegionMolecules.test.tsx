import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BUYER_COUNTRY_PROMPT, PRIVATE_SELLER_NOTICE, ROLE_STATEMENT } from '@/libs/commerce/eu-region';
import { BuyerCountryField } from './BuyerCountryField';
import { SellerAnnualLimitNotice } from './SellerAnnualLimitNotice';
import { SellerSaleTerms } from './SellerSaleTerms';
import { SellerStatusBadge } from './SellerStatusBadge';

describe('SellerStatusBadge', () => {
  it('names a private and a business seller and says nothing for an undeclared one', () => {
    const { rerender, container } = render(<SellerStatusBadge declaration="private" />);
    expect(screen.getByTestId('seller-status-badge-private')).toHaveTextContent('Private seller');
    rerender(<SellerStatusBadge declaration="trader" />);
    expect(screen.getByTestId('seller-status-badge-trader')).toHaveTextContent('Business seller');
    rerender(<SellerStatusBadge declaration="undeclared" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<SellerStatusBadge declaration="unknown" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('SellerSaleTerms', () => {
  it('always states the role of the marketplace and adds the private-seller notice for a private seller', () => {
    const { rerender } = render(<SellerSaleTerms declaration="private" />);
    expect(screen.getByTestId('role-statement')).toHaveTextContent(ROLE_STATEMENT);
    expect(screen.getByTestId('private-seller-notice')).toHaveTextContent(PRIVATE_SELLER_NOTICE);
    for (const declaration of ['trader', 'undeclared', 'unknown'] as const) {
      rerender(<SellerSaleTerms declaration={declaration} />);
      expect(screen.getByTestId('role-statement')).toBeInTheDocument();
      expect(screen.queryByTestId('private-seller-notice')).not.toBeInTheDocument();
    }
  });
});

describe('BuyerCountryField', () => {
  it('asks "Country you live in" and reports only an assigned two-letter code', () => {
    const onChange = vi.fn();
    render(<BuyerCountryField value={null} onChange={onChange} />);
    expect(screen.getByLabelText(BUYER_COUNTRY_PROMPT)).toBeInTheDocument();
    const input = screen.getByLabelText(BUYER_COUNTRY_PROMPT);

    fireEvent.change(input, { target: { value: 'de' } });
    expect(onChange).toHaveBeenLastCalledWith('DE');
    expect(input).toHaveValue('DE');

    fireEvent.change(input, { target: { value: 'x' } });
    expect(onChange).toHaveBeenLastCalledWith(null);

    fireEvent.change(input, { target: { value: 'uk' } });
    expect(onChange).toHaveBeenLastCalledWith('GB');

    fireEvent.change(input, { target: { value: 'zz' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByTestId('buyer-country-hint')).toHaveTextContent('Use a two-letter country code.');
  });

  it('names the remembered country', () => {
    render(<BuyerCountryField value="DE" onChange={vi.fn()} />);
    expect(screen.getByTestId('buyer-country-hint')).toHaveTextContent('Germany');
  });
});

describe('SellerAnnualLimitNotice', () => {
  const limit = {
    enabled: true,
    year: 2026,
    limitReached: false,
    residentInEu: true,
    salesLimit: 29,
    eurLimitCents: 200_000,
    sales: 12,
    eurCents: 85_000,
  };

  it('shows an EU-resident seller their counters', () => {
    render(<SellerAnnualLimitNotice limit={limit} />);
    expect(screen.getByTestId('seller-annual-limit-counters')).toHaveTextContent(
      'Sales this year: 12 of 29, €850 of €2,000',
    );
    expect(screen.queryByTestId('seller-annual-limit-reconfirm')).not.toBeInTheDocument();
    expect(screen.getByTestId('seller-annual-limit')).toHaveTextContent(
      'stop at 29 sales or €2,000 in total a calendar year, whichever comes first',
    );
  });

  it('asks a private seller to re-confirm', () => {
    render(
      <SellerAnnualLimitNotice
        limit={{ enabled: true, residentInEu: false, euBuyerSales: 29, reconfirmationRequired: true }}
      />,
    );
    expect(screen.getByTestId('seller-annual-limit-reconfirm')).toHaveTextContent('29 times');
    expect(screen.queryByTestId('seller-annual-limit-counters')).not.toBeInTheDocument();
  });

  it('shows nothing to a seller it does not concern', () => {
    const { container } = render(
      <SellerAnnualLimitNotice limit={{ enabled: true, residentInEu: false, limitReached: false }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
