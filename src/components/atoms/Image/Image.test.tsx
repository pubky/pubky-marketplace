import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Image } from './Image';

describe('Image', () => {
  it('renders with required props', () => {
    render(<Image src="/test-image.jpg" alt="Test image" data-testid="test-image" />);
    const image = screen.getByTestId('test-image');
    expect(image).toBeInTheDocument();
  });

  it('renders with correct src and alt attributes', () => {
    render(<Image src="/photo.jpg" alt="A beautiful photo" data-testid="photo" />);
    const image = screen.getByTestId('photo') as HTMLImageElement;
    expect(image.src).toContain('/photo.jpg');
    expect(image.alt).toBe('A beautiful photo');
  });

  it('applies custom className', () => {
    render(<Image src="/image.jpg" alt="Image" className="custom-class" data-testid="custom-image" />);
    const image = screen.getByTestId('custom-image');
    expect(image).toHaveClass('custom-class');
  });

  it('applies default classes', () => {
    render(<Image src="/image.jpg" alt="Image" data-testid="default-image" />);
    const image = screen.getByTestId('default-image');
    expect(image).toHaveClass('h-auto', 'max-w-full');
  });

  it('accepts additional HTML img attributes', () => {
    render(<Image src="/image.jpg" alt="Image" width={200} height={150} loading="lazy" data-testid="img-with-attrs" />);
    const image = screen.getByTestId('img-with-attrs') as HTMLImageElement;
    expect(image.width).toBe(200);
    expect(image.height).toBe(150);
    expect(image.getAttribute('loading')).toBe('lazy');
  });
});

describe('Image - Rendering', () => {
  it('applies default dimensions when width and height are not provided', () => {
    render(<Image src="/image.jpg" alt="Test image" data-testid="img" />);
    const image = screen.getByTestId('img') as HTMLImageElement;
    expect(image.getAttribute('width')).toBe('800');
    expect(image.getAttribute('height')).toBe('600');
  });

  it('omits width and height attributes in fill mode', () => {
    render(<Image src="/image.jpg" alt="Test image" fill data-testid="img" />);
    const image = screen.getByTestId('img');
    expect(image).not.toHaveAttribute('width');
    expect(image).not.toHaveAttribute('height');
  });

  it('passes through the loading attribute', () => {
    render(<Image src="/lazy.jpg" alt="Lazy loaded" loading="lazy" data-testid="img" />);
    expect(screen.getByTestId('img')).toHaveAttribute('loading', 'lazy');
  });

  it('passes through id and title attributes', () => {
    render(<Image src="/image.jpg" alt="Image" id="hero-image" title="Image tooltip" data-testid="img" />);
    const image = screen.getByTestId('img');
    expect(image).toHaveAttribute('id', 'hero-image');
    expect(image).toHaveAttribute('title', 'Image tooltip');
  });
});
