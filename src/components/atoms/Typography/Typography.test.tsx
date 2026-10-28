import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Typography } from './Typography';

describe('Typography', () => {
  it('renders a <p> element by default', () => {
    render(<Typography>Default text</Typography>);
    const typography = screen.getByTestId('typography');
    expect(typography.tagName).toBe('P');
    expect(typography).toHaveTextContent('Default text');
  });

  it.each([
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'span',
    'i',
    'b',
    'strong',
    'em',
    'small',
    'sub',
    'sup',
    'code',
    'pre',
    'blockquote',
    'label',
  ] as const)('renders as <%s> when as="%s"', (as) => {
    render(<Typography as={as}>Text</Typography>);
    expect(screen.getByTestId('typography').tagName).toBe(as.toUpperCase());
  });

  it('applies the default (md) size and foreground classes by default', () => {
    render(<Typography>Text</Typography>);
    expect(screen.getByTestId('typography')).toHaveClass('text-base', 'font-medium', 'text-foreground');
  });

  it.each([
    ['xs', ['text-xs', 'font-medium']],
    ['sm', ['text-sm', 'font-medium']],
    ['md', ['text-base', 'font-medium']],
    ['lg', ['text-2xl', 'font-bold']],
    ['xl', ['text-4xl', 'font-bold']],
    ['2xl', ['text-6xl', 'font-bold']],
  ] as const)('applies size="%s" classes', (size, classes) => {
    render(<Typography size={size}>Text</Typography>);
    expect(screen.getByTestId('typography')).toHaveClass(...classes);
  });

  it('merges a custom className with the default classes', () => {
    render(<Typography className="custom-typography">Text</Typography>);
    const typography = screen.getByTestId('typography');
    expect(typography).toHaveClass('text-base', 'font-medium', 'text-foreground', 'custom-typography');
  });

  it('drops the default classes when overrideDefaults is set', () => {
    render(
      <Typography overrideDefaults className="custom-typography">
        Text
      </Typography>,
    );
    const typography = screen.getByTestId('typography');
    expect(typography).toHaveClass('custom-typography');
    expect(typography).not.toHaveClass('text-base');
    expect(typography).not.toHaveClass('text-foreground');
  });

  it('uses the default data-testid when none is provided', () => {
    render(<Typography>Text</Typography>);
    expect(screen.getByTestId('typography')).toBeInTheDocument();
  });

  it('passes through a custom data-testid', () => {
    render(<Typography data-testid="custom-typography">Text</Typography>);
    expect(screen.getByTestId('custom-typography')).toBeInTheDocument();
  });

  it('passes through html attributes', () => {
    render(<Typography id="typography-id">Text</Typography>);
    expect(screen.getByTestId('typography')).toHaveAttribute('id', 'typography-id');
  });

  it('passes through htmlFor when rendered as a label', () => {
    render(
      <Typography as="label" htmlFor="field-id">
        Text
      </Typography>,
    );
    expect(screen.getByTestId('typography')).toHaveAttribute('for', 'field-id');
  });

  it('renders complex children', () => {
    render(
      <Typography>
        <span>Complex</span> <em>typography</em> content
      </Typography>,
    );
    const typography = screen.getByTestId('typography');
    expect(typography.querySelector('span')).toHaveTextContent('Complex');
    expect(typography.querySelector('em')).toHaveTextContent('typography');
    expect(typography).toHaveTextContent('Complex typography content');
  });
});
