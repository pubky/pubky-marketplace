import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Heading } from './Heading';

describe('Heading', () => {
  it('renders an <h1> with the default (md) size by default', () => {
    render(<Heading>Default Heading</Heading>);
    const heading = screen.getByTestId('heading-1');
    expect(heading.tagName).toBe('H1');
    expect(heading).toHaveTextContent('Default Heading');
    expect(heading).toHaveClass('text-xl', 'font-semibold', 'text-foreground');
  });

  it.each([1, 2, 3, 4, 5, 6] as const)('renders as <h%i> when level=%i', (level) => {
    render(<Heading level={level}>Heading</Heading>);
    const heading = screen.getByTestId(`heading-${level}`);
    expect(heading.tagName).toBe(`H${level}`);
  });

  it.each([
    ['sm', ['text-lg', 'font-semibold']],
    ['md', ['text-xl', 'font-semibold']],
    ['lg', ['text-2xl', 'font-bold']],
    ['xl', ['text-4xl', 'font-bold']],
    ['2xl', ['text-7xl', 'sm:text-9xl', 'font-bold']],
  ] as const)('applies size="%s" classes', (size, classes) => {
    render(<Heading size={size}>Heading</Heading>);
    expect(screen.getByTestId('heading-1')).toHaveClass(...classes);
  });

  it('applies the size classes for a combined level and size', () => {
    render(
      <Heading level={3} size="2xl">
        Heading
      </Heading>,
    );
    const heading = screen.getByTestId('heading-3');
    expect(heading.tagName).toBe('H3');
    expect(heading).toHaveClass('text-7xl', 'sm:text-9xl', 'font-bold');
  });

  it('merges a custom className with the default classes', () => {
    render(<Heading className="custom-heading-class">Heading</Heading>);
    expect(screen.getByTestId('heading-1')).toHaveClass(
      'text-xl',
      'font-semibold',
      'text-foreground',
      'custom-heading-class',
    );
  });

  it('renders complex children', () => {
    render(
      <Heading>
        <span>Part 1</span> and <strong>Part 2</strong>
      </Heading>,
    );
    const heading = screen.getByTestId('heading-1');
    expect(heading.querySelector('span')).toHaveTextContent('Part 1');
    expect(heading.querySelector('strong')).toHaveTextContent('Part 2');
  });
});
