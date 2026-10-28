import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders children inside a Container by default', () => {
    render(<PageHeader>Header content</PageHeader>);
    const header = screen.getByTestId('container');
    expect(header).toHaveTextContent('Header content');
    expect(header).toHaveClass('gap-3', 'pt-2', 'pb-6');
  });

  it('merges a custom className with the default classes', () => {
    render(<PageHeader className="custom-header">Header content</PageHeader>);
    expect(screen.getByTestId('container')).toHaveClass('gap-3', 'pt-2', 'pb-6', 'custom-header');
  });

  it('passes through a custom data-testid', () => {
    render(<PageHeader data-testid="page-header">Header content</PageHeader>);
    expect(screen.getByTestId('page-header')).toBeInTheDocument();
  });

  it('passes through html attributes', () => {
    render(<PageHeader id="header-id">Header content</PageHeader>);
    expect(screen.getByTestId('container')).toHaveAttribute('id', 'header-id');
  });

  it('renders complex children', () => {
    render(
      <PageHeader>
        <h1>Page Title</h1>
        <p>Page Subtitle</p>
      </PageHeader>,
    );
    const header = screen.getByTestId('container');
    expect(header.querySelector('h1')).toHaveTextContent('Page Title');
    expect(header.querySelector('p')).toHaveTextContent('Page Subtitle');
  });
});
