import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { RegionAvailability } from '@/hooks/useRegionAvailability/useRegionAvailability';
import {
  BUYER_COUNTRY_DIGITAL_INFO,
  BUYER_COUNTRY_INFO,
  BUYER_COUNTRY_INFO_LABEL,
  BUYER_COUNTRY_PROMPT,
  SALE_INFO_LABEL,
  SALE_INFO_PRIVATE,
  SALE_INFO_ROLE,
} from '@/libs/commerce/eu-region';
import { BuyerCountryField } from './BuyerCountryField';
import { RegionAvailabilityNotice } from './RegionAvailabilityNotice';
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
  it('puts the role of the marketplace behind an info icon, and the private-seller notice too for a private seller', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SellerSaleTerms declaration="private" />);
    const icon = screen.getByRole('button', { name: SALE_INFO_LABEL });
    expect(screen.queryByTestId('info-hint-content')).not.toBeInTheDocument();
    await user.click(icon);
    expect(screen.getByTestId('info-hint-content')).toHaveTextContent(SALE_INFO_PRIVATE);
    expect(screen.getByTestId('info-hint-content')).toHaveTextContent(SALE_INFO_ROLE);
    await user.keyboard('{Escape}');

    for (const declaration of ['trader', 'undeclared', 'unknown'] as const) {
      rerender(<SellerSaleTerms declaration={declaration} />);
      await user.click(screen.getByRole('button', { name: SALE_INFO_LABEL }));
      expect(screen.getByTestId('info-hint-content')).toHaveTextContent(SALE_INFO_ROLE);
      expect(screen.getByTestId('info-hint-content')).not.toHaveTextContent('private individual');
      await user.keyboard('{Escape}');
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
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith('DE');
    expect(input).toHaveValue('DE');

    fireEvent.change(input, { target: { value: 'uk' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('GB');

    onChange.mockClear();
    fireEvent.change(input, { target: { value: 'zz' } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('buyer-country-hint')).toHaveTextContent('Use a two-letter country code.');
  });

  it('commits a country only when the buyer confirms it, never mid-typing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<BuyerCountryField value="BE" onChange={onChange} />);
    const input = screen.getByLabelText(BUYER_COUNTRY_PROMPT);

    await user.clear(input);
    await user.type(input, 'CH');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('buyer-country-hint')).toHaveTextContent('Switzerland');

    await user.tab();
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith('CH');
  });

  it('explains why it asks behind an info icon instead of in the page', async () => {
    render(<BuyerCountryField value={null} onChange={vi.fn()} />);
    expect(screen.queryByTestId('buyer-country-hint')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: BUYER_COUNTRY_INFO_LABEL }));
    expect(screen.getByTestId('info-hint-content')).toHaveTextContent(BUYER_COUNTRY_INFO);
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
    expect(screen.getByRole('button', { name: 'About the yearly limit' })).toBeInTheDocument();
  });

  it('explains the limit behind the info icon', async () => {
    render(<SellerAnnualLimitNotice limit={limit} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'About the yearly limit' }));
    expect(screen.getByTestId('info-hint-content')).toHaveTextContent(
      'can make 29 sales or €2,000 a calendar year, whichever comes first',
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

describe('RegionAvailabilityNotice', () => {
  const base: RegionAvailability = {
    enabled: true,
    buyerCountry: null,
    setBuyerCountry: vi.fn(),
    needsCountry: false,
    refusal: null,
    canChangeCountry: false,
    usesCountry: false,
    digitalNote: null,
  };

  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<RegionAvailabilityNotice region={base} testIdPrefix="x" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('asks for the country when it is needed', () => {
    render(<RegionAvailabilityNotice region={{ ...base, needsCountry: true }} testIdPrefix="x" />);
    expect(screen.getByLabelText(BUYER_COUNTRY_PROMPT)).toHaveValue('');
  });

  it('shows the refusal with the remembered country open to correction', () => {
    render(
      <RegionAvailabilityNotice
        region={{ ...base, buyerCountry: 'DE', refusal: 'Not available to buyers in the EU', canChangeCountry: true }}
        testIdPrefix="x"
      />,
    );
    expect(screen.getByTestId('x-region-refusal')).toHaveTextContent('Not available to buyers in the EU');
    expect(screen.getByLabelText(BUYER_COUNTRY_PROMPT)).toHaveValue('DE');
  });

  it('shows a refusal that no country can fix without a country field', () => {
    render(
      <RegionAvailabilityNotice
        region={{ ...base, buyerCountry: 'US', refusal: 'Not taking orders' }}
        testIdPrefix="x"
      />,
    );
    expect(screen.getByTestId('x-region-refusal')).toBeInTheDocument();
    expect(screen.queryByLabelText(BUYER_COUNTRY_PROMPT)).not.toBeInTheDocument();
  });

  it('says nothing more on a digital item once the country is known and allowed', () => {
    const { container } = render(
      <RegionAvailabilityNotice
        region={{ ...base, buyerCountry: 'US', digitalNote: 'Digital note' }}
        testIdPrefix="x"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps a country the decision depends on in view, with a way to change it', async () => {
    const user = userEvent.setup();
    const setBuyerCountry = vi.fn();
    render(
      <RegionAvailabilityNotice
        region={{ ...base, buyerCountry: 'CH', usesCountry: true, digitalNote: 'Digital note', setBuyerCountry }}
        testIdPrefix="x"
      />,
    );
    expect(screen.getByTestId('x-region-country')).toHaveTextContent(`${BUYER_COUNTRY_PROMPT}: Switzerland`);
    expect(screen.queryByLabelText(BUYER_COUNTRY_PROMPT)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Change' }));
    const input = screen.getByLabelText(BUYER_COUNTRY_PROMPT);
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, 'US{Enter}');
    expect(setBuyerCountry).toHaveBeenCalledWith('US');
    expect(screen.getByTestId('x-region-country')).toBeInTheDocument();
  });

  it('gives the digital reason for asking behind the country field’s info icon', async () => {
    render(
      <RegionAvailabilityNotice
        region={{ ...base, needsCountry: true, digitalNote: 'Digital note' }}
        testIdPrefix="x"
      />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: BUYER_COUNTRY_INFO_LABEL }));
    expect(screen.getByTestId('info-hint-content')).toHaveTextContent(BUYER_COUNTRY_DIGITAL_INFO);
  });
});
