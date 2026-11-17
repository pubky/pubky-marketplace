import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AvatarEmojiBadge } from './AvatarEmojiBadge';

describe('AvatarEmojiBadge', () => {
  it('renders emoji correctly', () => {
    render(<AvatarEmojiBadge emoji="🌴" />);
    expect(screen.getByText('🌴')).toBeInTheDocument();
  });

  it('renders different emoji', () => {
    render(<AvatarEmojiBadge emoji="🚀" />);
    expect(screen.getByText('🚀')).toBeInTheDocument();
  });

  it('applies the badge positioning and size classes', () => {
    render(<AvatarEmojiBadge emoji="🌴" />);
    expect(screen.getByText('🌴')).toHaveClass(
      'absolute',
      '-right-1',
      '-bottom-1',
      'flex',
      'size-10',
      'items-center',
      'justify-center',
    );
  });
});
