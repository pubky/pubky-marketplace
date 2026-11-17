import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageSubtitle } from './PageSubtitle';

describe('PageSubtitle', () => {
  it('renders an <h2> with the default classes by default', () => {
    render(<PageSubtitle>Test subtitle</PageSubtitle>);
    const subtitle = screen.getByText('Test subtitle');
    expect(subtitle.tagName).toBe('H2');
    expect(subtitle).toHaveClass('text-xl', 'leading-normal', 'font-medium', 'text-muted-foreground', 'lg:text-2xl');
  });

  it.each(['h2', 'h5', 'p'] as const)('renders as <%s> when as="%s"', (as) => {
    render(<PageSubtitle as={as}>Subtitle</PageSubtitle>);
    expect(screen.getByText('Subtitle').tagName).toBe(as.toUpperCase());
  });

  it('renders the title prop as content', () => {
    render(<PageSubtitle title="Title prop subtitle" />);
    expect(screen.getByText('Title prop subtitle')).toBeInTheDocument();
  });

  it('prefers the title prop over children', () => {
    render(<PageSubtitle title="Title wins">Child content</PageSubtitle>);
    expect(screen.getByText('Title wins')).toBeInTheDocument();
    expect(screen.queryByText('Child content')).not.toBeInTheDocument();
  });

  it('merges a custom className with the default classes', () => {
    render(<PageSubtitle className="custom-subtitle">Subtitle</PageSubtitle>);
    expect(screen.getByText('Subtitle')).toHaveClass('text-xl', 'text-muted-foreground', 'custom-subtitle');
  });

  it('passes through html attributes', () => {
    render(<PageSubtitle id="subtitle-id">Subtitle</PageSubtitle>);
    expect(screen.getByText('Subtitle')).toHaveAttribute('id', 'subtitle-id');
  });

  it('passes through a data-testid', () => {
    render(<PageSubtitle data-testid="page-subtitle">Subtitle</PageSubtitle>);
    expect(screen.getByTestId('page-subtitle')).toBeInTheDocument();
  });

  it('renders complex children', () => {
    render(
      <PageSubtitle>
        <span>Complex</span> <strong>subtitle</strong> content
      </PageSubtitle>,
    );
    const subtitle = screen.getByRole('heading');
    expect(subtitle.querySelector('span')).toHaveTextContent('Complex');
    expect(subtitle.querySelector('strong')).toHaveTextContent('subtitle');
  });
});
