import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SHOPIFY_GUIDE_SCREENS } from '@/config/shopify-guide';
import { ShopifyGuideFigure } from './ShopifyGuideFigure';

describe('ShopifyGuideFigure', () => {
  afterEach(() => vi.resetModules());

  it.each(SHOPIFY_GUIDE_SCREENS)('draws the %s screen with a label until a screenshot exists', (screen_) => {
    render(<ShopifyGuideFigure screen={screen_} />);
    const figure = screen.getByTestId(`guide-figure-${screen_}`);
    expect(figure).toHaveAttribute('data-kind', 'drawing');
    expect(figure.querySelector('svg')).toHaveAttribute('aria-label');
    expect(figure.querySelectorAll('path, rect, circle').length).toBeGreaterThan(8);
  });

  it('shows the real screenshot in the same slot once one is configured', async () => {
    vi.doMock('@/config/shopify-guide', async () => {
      const actual = await vi.importActual<typeof import('@/config/shopify-guide')>('@/config/shopify-guide');
      return {
        ...actual,
        SHOPIFY_GUIDE_SCREENSHOTS: {
          configure: {
            src: '/images/shopify-guide/configure.webp',
            alt: 'The app version form',
            width: 1200,
            height: 800,
          },
        },
      };
    });
    const { ShopifyGuideFigure: Figure } = await import('./ShopifyGuideFigure');
    render(<Figure screen="configure" />);

    const figure = screen.getByTestId('guide-figure-configure');
    expect(figure).toHaveAttribute('data-kind', 'screenshot');
    expect(screen.getByAltText('The app version form')).toBeInTheDocument();
    expect(figure.querySelector('svg')).toBeNull();
    vi.doUnmock('@/config/shopify-guide');
  });
});
