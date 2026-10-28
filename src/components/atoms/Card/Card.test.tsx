import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './Card';

describe('Card', () => {
  it('renders complete card structure', () => {
    render(
      <Card data-testid="complete-card">
        <CardHeader>
          <CardTitle>Card Title</CardTitle>
          <CardDescription>Card Description</CardDescription>
          <CardAction>Action</CardAction>
        </CardHeader>
        <CardContent>Card Content</CardContent>
        <CardFooter>Card Footer</CardFooter>
      </Card>,
    );

    expect(screen.getByTestId('complete-card')).toBeInTheDocument();
    expect(screen.getByText('Card Title')).toBeInTheDocument();
    expect(screen.getByText('Card Description')).toBeInTheDocument();
    expect(screen.getByText('Action')).toBeInTheDocument();
    expect(screen.getByText('Card Content')).toBeInTheDocument();
    expect(screen.getByText('Card Footer')).toBeInTheDocument();
  });

  it('renders with the card data-slot, data-testid and base classes by default', () => {
    render(<Card>Card content</Card>);
    const card = screen.getByTestId('card');
    expect(card).toHaveAttribute('data-slot', 'card');
    expect(card).toHaveClass('flex', 'flex-col', 'gap-6', 'rounded-xl', 'bg-card', 'shadow-sm');
  });

  it('merges a custom className with the base classes', () => {
    render(<Card className="custom-card">Card content</Card>);
    expect(screen.getByTestId('card')).toHaveClass('rounded-xl', 'bg-card', 'custom-card');
  });

  it('forwards extra props to the root element', () => {
    render(<Card aria-label="Product card">Card content</Card>);
    expect(screen.getByTestId('card')).toHaveAttribute('aria-label', 'Product card');
  });

  it.each([
    ['CardHeader', 'card-header', <CardHeader key="c">Header</CardHeader>],
    ['CardTitle', 'card-title', <CardTitle key="c">Title</CardTitle>],
    ['CardDescription', 'card-description', <CardDescription key="c">Description</CardDescription>],
    ['CardAction', 'card-action', <CardAction key="c">Action</CardAction>],
    ['CardContent', 'card-content', <CardContent key="c">Content</CardContent>],
    ['CardFooter', 'card-footer', <CardFooter key="c">Footer</CardFooter>],
  ])('%s renders its data-slot', (name, slot, element) => {
    const { container } = render(element);
    expect(container.querySelector(`[data-slot="${slot}"]`)).toBeInTheDocument();
  });

  it('applies the CardTitle base classes', () => {
    const { container } = render(<CardTitle>Title</CardTitle>);
    expect(container.querySelector('[data-slot="card-title"]')).toHaveClass('leading-none', 'font-semibold');
  });

  it('applies the CardDescription base classes', () => {
    const { container } = render(<CardDescription>Description</CardDescription>);
    expect(container.querySelector('[data-slot="card-description"]')).toHaveClass('text-sm', 'text-muted-foreground');
  });

  it('applies the CardContent base classes', () => {
    const { container } = render(<CardContent>Content</CardContent>);
    expect(container.querySelector('[data-slot="card-content"]')).toHaveClass('px-6');
  });

  it('merges className on sub-components', () => {
    const { container } = render(<CardHeader className="custom-header">Header</CardHeader>);
    expect(container.querySelector('[data-slot="card-header"]')).toHaveClass('px-6', 'custom-header');
  });
});
