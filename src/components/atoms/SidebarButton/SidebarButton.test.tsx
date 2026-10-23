import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { FileText, LockKeyhole, Users } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarButton } from './SidebarButton';

describe('SidebarButton', () => {
  it('renders with icon and children', () => {
    render(<SidebarButton icon={FileText}>Test Button</SidebarButton>);
    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent('Test Button');
  });

  it('renders with different icons', () => {
    const { rerender } = render(<SidebarButton icon={FileText}>File Button</SidebarButton>);
    let button = screen.getByRole('button');
    expect(button.querySelector('svg')).toBeInTheDocument();

    rerender(<SidebarButton icon={LockKeyhole}>Lock Button</SidebarButton>);
    button = screen.getByRole('button');
    expect(button.querySelector('svg')).toBeInTheDocument();
    expect(button).toHaveTextContent('Lock Button');

    rerender(<SidebarButton icon={Users}>Users Button</SidebarButton>);
    button = screen.getByRole('button');
    expect(button.querySelector('svg')).toBeInTheDocument();
    expect(button).toHaveTextContent('Users Button');
  });

  it('handles click events', () => {
    const handleClick = vi.fn();
    render(
      <SidebarButton icon={FileText} onClick={handleClick}>
        Click me
      </SidebarButton>,
    );

    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});

describe('SidebarButton - Rendering', () => {
  it('applies the sidebar button classes', () => {
    render(<SidebarButton icon={FileText}>Terms of service</SidebarButton>);
    expect(screen.getByRole('button')).toHaveClass('w-full', 'border-border', 'bg-white/5', 'text-xs', 'font-bold');
  });

  it('renders the icon at the fixed size', () => {
    render(<SidebarButton icon={FileText}>Terms of service</SidebarButton>);
    expect(screen.getByRole('button').querySelector('svg')).toHaveClass('size-4');
  });
});
