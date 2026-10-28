import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageContainer, PageTitle } from './Page';

describe('PageContainer', () => {
  it('renders a <div> with the default size classes by default', () => {
    render(
      <PageContainer>
        <div>Test content</div>
      </PageContainer>,
    );

    const container = screen.getByTestId('page-container');
    expect(container.tagName).toBe('DIV');
    expect(container).toHaveTextContent('Test content');
    expect(container).toHaveClass('w-full', 'mx-auto');
    expect(container.className).not.toContain('max-w-[588px]');
  });

  it.each([
    ['div', 'DIV'],
    ['main', 'MAIN'],
    ['section', 'SECTION'],
  ] as const)('renders as <%s> when as="%s"', (as, tagName) => {
    render(<PageContainer as={as}>Content</PageContainer>);

    expect(screen.getByTestId('page-container').tagName).toBe(tagName);
  });

  it('applies the narrow size class', () => {
    render(<PageContainer size="narrow">Content</PageContainer>);

    expect(screen.getByTestId('page-container')).toHaveClass('w-full', 'mx-auto', 'max-w-[588px]');
  });

  it('merges a custom className', () => {
    render(<PageContainer className="custom-page">Content</PageContainer>);

    expect(screen.getByTestId('page-container')).toHaveClass('w-full', 'custom-page');
  });
});

describe('PageTitle', () => {
  it('renders an h1 heading with the large size classes by default', () => {
    render(<PageTitle>Default Title</PageTitle>);

    const title = screen.getByTestId('heading-1');
    expect(title.tagName).toBe('H1');
    expect(title).toHaveTextContent('Default Title');
    expect(title).toHaveClass('text-5xl', 'lg:text-6xl');
  });

  it('applies the medium size classes', () => {
    render(<PageTitle size="medium">Medium Title</PageTitle>);

    expect(screen.getByTestId('heading-1')).toHaveClass('text-4xl', 'lg:text-[60px]');
  });

  it('merges a custom className', () => {
    render(<PageTitle className="custom-title">Title</PageTitle>);

    expect(screen.getByTestId('heading-1')).toHaveClass('text-5xl', 'custom-title');
  });
});
