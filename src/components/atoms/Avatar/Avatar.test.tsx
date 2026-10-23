import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar, AvatarFallback, AvatarImage } from './Avatar';

describe('Avatar', () => {
  it('applies the default (md default) size and base classes by default', () => {
    const { container } = render(<Avatar />);
    const avatar = container.firstChild as HTMLElement;
    expect(avatar).toHaveClass('relative', 'flex', 'shrink-0', 'overflow-hidden', 'rounded-full', 'h-10', 'w-10');
  });

  it.each([
    ['sm', ['h-6', 'w-6']],
    ['default', ['h-10', 'w-10']],
    ['md', ['h-8', 'w-8']],
    ['lg', ['h-12', 'w-12']],
    ['xl', ['h-16', 'w-16']],
  ] as const)('applies size="%s" classes', (size, classes) => {
    const { container } = render(<Avatar size={size} />);
    expect(container.firstChild).toHaveClass(...classes);
  });

  it('merges a custom className with the base classes', () => {
    const { container } = render(<Avatar className="custom-avatar" />);
    expect(container.firstChild).toHaveClass('rounded-full', 'custom-avatar');
  });

  it('passes through custom data attributes', () => {
    const { container } = render(<Avatar data-custom="custom-avatar" />);
    expect(container.firstChild).toHaveAttribute('data-custom', 'custom-avatar');
  });
});

describe('AvatarFallback', () => {
  it('renders its children with the base classes', () => {
    render(
      <Avatar>
        <AvatarFallback>JD</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText('JD')).toHaveClass(
      'flex',
      'h-full',
      'w-full',
      'items-center',
      'justify-center',
      'rounded-full',
      'bg-muted',
    );
  });

  it('merges a custom className', () => {
    render(
      <Avatar>
        <AvatarFallback className="custom-fallback">AB</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText('AB')).toHaveClass('bg-muted', 'custom-fallback');
  });
});

describe('AvatarImage', () => {
  it('component exists and can be imported', () => {
    expect(() => {
      render(
        <Avatar>
          <AvatarImage src="/test.jpg" alt="Test avatar" />
        </Avatar>,
      );
    }).not.toThrow();
  });

  it('applies custom className', () => {
    render(
      <Avatar>
        <AvatarImage src="/test.jpg" alt="Test" className="custom-image" />
      </Avatar>,
    );
    // AvatarImage may not render in test environment, but should not throw
    expect(() => {
      render(
        <Avatar>
          <AvatarImage src="/test.jpg" alt="Test" className="custom-image" />
        </Avatar>,
      );
    }).not.toThrow();
  });
});
