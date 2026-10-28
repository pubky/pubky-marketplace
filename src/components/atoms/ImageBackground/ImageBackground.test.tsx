import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImageBackground } from './ImageBackground';

describe('ImageBackground', () => {
  it('renders with default props', () => {
    render(<ImageBackground image="/bg-image.jpg" />);
    const imageBackground = screen.getByTestId('image-background');
    expect(imageBackground).toBeInTheDocument();
  });

  it('switches between single and dual background mode', () => {
    const { rerender } = render(<ImageBackground image="/bg.jpg" data-testid="image-background" />);

    // Initially single background
    let background = screen.getByTestId('image-background');
    expect(background).toBeInTheDocument();

    // Add mobileImage - should now render two backgrounds
    rerender(<ImageBackground image="/bg-desktop.jpg" mobileImage="/bg-mobile.jpg" data-testid="image-background" />);

    const backgrounds = screen.getAllByTestId('image-background');
    expect(backgrounds).toHaveLength(2);

    // Remove mobileImage - should go back to single background
    rerender(<ImageBackground image="/bg.jpg" data-testid="image-background" />);
    background = screen.getByTestId('image-background');
    expect(background).toBeInTheDocument();
  });
});

describe('ImageBackground - Rendering', () => {
  it('applies the base classes by default', () => {
    render(<ImageBackground image="/bg-image.jpg" />);
    expect(screen.getByTestId('image-background')).toHaveClass(
      'fixed',
      'inset-0',
      'bg-cover',
      'bg-center',
      'bg-no-repeat',
      '-z-10',
    );
  });

  it('sets the image as the background style', () => {
    render(<ImageBackground image="/background.jpg" />);
    expect(screen.getByTestId('image-background')).toHaveStyle({ backgroundImage: 'url(/background.jpg)' });
  });

  it('merges a custom className with the base classes', () => {
    render(<ImageBackground image="/custom-bg.jpg" className="custom-bg" />);
    expect(screen.getByTestId('image-background')).toHaveClass('fixed', 'custom-bg');
  });

  it('passes through html attributes', () => {
    render(<ImageBackground image="/bg.jpg" id="background-id" />);
    expect(screen.getByTestId('image-background')).toHaveAttribute('id', 'background-id');
  });

  it('renders a mobile and a desktop background when mobileImage is provided', () => {
    render(<ImageBackground image="/bg-desktop.jpg" mobileImage="/bg-mobile.jpg" data-testid="image-background" />);
    const [mobile, desktop] = screen.getAllByTestId('image-background');
    expect(mobile).toHaveClass('lg:hidden');
    expect(mobile).toHaveStyle({ backgroundImage: 'url(/bg-mobile.jpg)' });
    expect(desktop).toHaveClass('hidden', 'lg:block');
    expect(desktop).toHaveStyle({ backgroundImage: 'url(/bg-desktop.jpg)' });
  });
});
