import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FooterLinks } from './FooterLinks';

describe('FooterLinks', () => {
  it('renders a Typography paragraph with the default classes by default', () => {
    render(<FooterLinks>Footer text</FooterLinks>);
    const footer = screen.getByTestId('typography');
    expect(footer.tagName).toBe('P');
    expect(footer).toHaveTextContent('Footer text');
    expect(footer).toHaveClass('leading-light', 'text-sm', 'font-medium', 'text-muted-foreground', 'opacity-80');
  });

  it('merges a custom className with the default classes', () => {
    render(<FooterLinks className="custom-footer">Footer text</FooterLinks>);
    expect(screen.getByTestId('typography')).toHaveClass('text-muted-foreground', 'custom-footer');
  });

  it('passes through a custom data-testid', () => {
    render(<FooterLinks data-testid="custom-footer-links">Footer text</FooterLinks>);
    expect(screen.getByTestId('custom-footer-links')).toBeInTheDocument();
  });

  it('passes through html attributes', () => {
    render(<FooterLinks id="footer-id">Footer text</FooterLinks>);
    expect(screen.getByTestId('typography')).toHaveAttribute('id', 'footer-id');
  });

  it('renders complex children', () => {
    render(
      <FooterLinks>
        <span>Copyright 2024</span> | <a href="/privacy">Privacy</a>
      </FooterLinks>,
    );
    const footer = screen.getByTestId('typography');
    expect(footer.querySelector('span')).toHaveTextContent('Copyright 2024');
    expect(footer.querySelector('a')).toHaveAttribute('href', '/privacy');
  });

  it('renders without children', () => {
    render(<FooterLinks />);
    expect(screen.getByTestId('typography')).toBeInTheDocument();
  });
});
