import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Container } from './Container';

describe('Container', () => {
  it('renders a <div> with the default classes by default', () => {
    render(<Container>Default Container</Container>);
    const container = screen.getByTestId('container');
    expect(container.tagName).toBe('DIV');
    expect(container).toHaveTextContent('Default Container');
    expect(container).toHaveClass('mx-auto', 'w-full', 'flex-col', 'flex');
  });

  it.each([
    ['div', 'DIV'],
    ['section', 'SECTION'],
    ['article', 'ARTICLE'],
    ['main', 'MAIN'],
    ['header', 'HEADER'],
    ['footer', 'FOOTER'],
    ['aside', 'ASIDE'],
    ['nav', 'NAV'],
    ['figure', 'FIGURE'],
  ] as const)('renders as <%s> when as="%s"', (as, tagName) => {
    render(<Container as={as}>Content</Container>);
    expect(screen.getByTestId('container').tagName).toBe(tagName);
  });

  it('applies no max-width class for the default size', () => {
    render(<Container size="default">Content</Container>);
    const container = screen.getByTestId('container');
    expect(container.className).not.toContain('max-w');
  });

  it.each([
    ['sm', 'max-w-screen-sm'],
    ['md', 'max-w-screen-md'],
    ['lg', 'max-w-screen-lg'],
    ['xl', 'max-w-screen-xl'],
    ['container', 'max-w-(--container-max-width)'],
  ] as const)('applies size="%s" as the %s class', (size, sizeClass) => {
    render(<Container size={size}>Content</Container>);
    expect(screen.getByTestId('container')).toHaveClass(sizeClass);
  });

  it.each([
    ['flex', 'flex'],
    ['grid', 'grid'],
    ['block', 'block'],
  ] as const)('applies display="%s" as the %s class', (display, displayClass) => {
    render(<Container display={display}>Content</Container>);
    expect(screen.getByTestId('container')).toHaveClass(displayClass);
  });

  it('drops the default classes when overrideDefaults is set', () => {
    render(
      <Container overrideDefaults className="custom-class">
        Content
      </Container>,
    );
    const container = screen.getByTestId('container');
    expect(container).toHaveClass('custom-class');
    expect(container).not.toHaveClass('mx-auto');
    expect(container).not.toHaveClass('flex');
  });

  it('merges a custom className with the default classes', () => {
    render(<Container className="custom-class">Content</Container>);
    expect(screen.getByTestId('container')).toHaveClass('mx-auto', 'w-full', 'flex-col', 'custom-class');
  });

  it('passes through a custom data-testid', () => {
    render(<Container data-testid="custom-container">Content</Container>);
    expect(screen.getByTestId('custom-container')).toBeInTheDocument();
  });

  it('applies combined props together', () => {
    render(
      <Container as="article" size="lg" display="grid" className="custom-class">
        Content
      </Container>,
    );
    const container = screen.getByTestId('container');
    expect(container.tagName).toBe('ARTICLE');
    expect(container).toHaveClass('grid', 'max-w-screen-lg', 'custom-class');
  });

  describe('Accessibility Props', () => {
    it('renders with aria-modal attribute', () => {
      render(
        <Container aria-modal={true} data-testid="modal-container">
          Modal Container
        </Container>,
      );
      const container = screen.getByTestId('modal-container');
      expect(container).toHaveAttribute('aria-modal', 'true');
    });

    it('renders with aria-label attribute', () => {
      render(
        <Container aria-label="Test Label" data-testid="labeled-container">
          Labeled Container
        </Container>,
      );
      const container = screen.getByTestId('labeled-container');
      expect(container).toHaveAttribute('aria-label', 'Test Label');
    });

    it('renders with tabIndex attribute', () => {
      render(
        <Container tabIndex={-1} data-testid="focusable-container">
          Focusable Container
        </Container>,
      );
      const container = screen.getByTestId('focusable-container');
      expect(container).toHaveAttribute('tabIndex', '-1');
    });

    it('renders with combined ARIA attributes for dialog', () => {
      render(
        <Container
          role="dialog"
          aria-modal={true}
          aria-label="Dialog Title"
          tabIndex={-1}
          data-testid="dialog-container"
        >
          Dialog Content
        </Container>,
      );
      const container = screen.getByTestId('dialog-container');
      expect(container).toHaveAttribute('role', 'dialog');
      expect(container).toHaveAttribute('aria-modal', 'true');
      expect(container).toHaveAttribute('aria-label', 'Dialog Title');
      expect(container).toHaveAttribute('tabIndex', '-1');
    });
  });
});
