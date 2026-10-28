import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { List } from './List';

describe('List', () => {
  it('renders a <ul> with the default classes by default', () => {
    render(
      <List>
        <li>Item 1</li>
      </List>,
    );
    const list = screen.getByTestId('list');
    expect(list.tagName).toBe('UL');
    expect(list).toHaveClass('ml-6', 'text-base', 'font-normal', 'text-muted-foreground', 'list-disc');
  });

  it.each([
    ['ul', 'UL'],
    ['ol', 'OL'],
  ] as const)('renders as <%s> when as="%s"', (as, tagName) => {
    render(
      <List as={as}>
        <li>Item</li>
      </List>,
    );
    expect(screen.getByTestId('list').tagName).toBe(tagName);
  });

  it.each([
    ['default', 'list-disc'],
    ['decimal', 'list-decimal'],
    ['none', 'list-none'],
  ] as const)('applies variant="%s" as the %s class', (variant, variantClass) => {
    render(
      <List variant={variant}>
        <li>Item</li>
      </List>,
    );
    expect(screen.getByTestId('list')).toHaveClass(variantClass);
  });

  it('merges a custom className with the default classes', () => {
    render(
      <List className="custom-list-class">
        <li>Item</li>
      </List>,
    );
    expect(screen.getByTestId('list')).toHaveClass('ml-6', 'list-disc', 'custom-list-class');
  });

  it('passes through a custom data-testid', () => {
    render(
      <List data-testid="custom-list">
        <li>Item</li>
      </List>,
    );
    expect(screen.getByTestId('custom-list')).toBeInTheDocument();
  });

  it('passes through html attributes', () => {
    render(
      <List id="test-list" aria-label="Test list">
        <li>Item</li>
      </List>,
    );
    const list = screen.getByTestId('list');
    expect(list).toHaveAttribute('id', 'test-list');
    expect(list).toHaveAttribute('aria-label', 'Test list');
  });

  it('renders multiple items', () => {
    render(
      <List>
        <li>First item</li>
        <li>Second item</li>
        <li>Third item</li>
      </List>,
    );
    expect(screen.getByTestId('list').children).toHaveLength(3);
  });
});
