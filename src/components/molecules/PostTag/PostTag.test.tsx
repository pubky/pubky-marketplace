import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getTagDayPalette } from '@/libs/utils/tagPalette';
import { PostTag } from './PostTag';

describe('PostTag', () => {
  it('calls onClick when tag is clicked', () => {
    const mockOnClick = vi.fn();
    render(<PostTag label="bitcoin" onClick={mockOnClick} />);

    const tag = screen.getByRole('button');
    fireEvent.click(tag);

    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when close button is clicked', () => {
    const mockOnClose = vi.fn();
    render(<PostTag label="bitcoin" showClose onClose={mockOnClose} />);

    const closeButton = screen.getByLabelText(/remove bitcoin tag/i);
    fireEvent.click(closeButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('suppresses navigation (preventDefault + stopPropagation) on click, while still calling onClick', () => {
    const mockOnClick = vi.fn();
    render(<PostTag label="bitcoin" onClick={mockOnClick} />);

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    const preventDefault = vi.spyOn(clickEvent, 'preventDefault');
    const stopPropagation = vi.spyOn(clickEvent, 'stopPropagation');
    screen.getByRole('button').dispatchEvent(clickEvent);

    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });

  it('suppresses navigation on close, while still calling onClose', () => {
    const mockOnClose = vi.fn();
    render(<PostTag label="bitcoin" showClose onClose={mockOnClose} />);

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    const preventDefault = vi.spyOn(clickEvent, 'preventDefault');
    const stopPropagation = vi.spyOn(clickEvent, 'stopPropagation');
    screen.getByLabelText(/remove bitcoin tag/i).dispatchEvent(clickEvent);

    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick when close button is clicked', () => {
    const mockOnClick = vi.fn();
    const mockOnClose = vi.fn();
    render(<PostTag label="bitcoin" showClose onClick={mockOnClick} onClose={mockOnClose} />);

    const closeButton = screen.getByLabelText(/remove bitcoin tag/i);
    fireEvent.click(closeButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
    expect(mockOnClick).not.toHaveBeenCalled();
  });

  it('updates aria-label when count is provided', () => {
    const { rerender } = render(<PostTag label="bitcoin" />);
    expect(screen.getByLabelText(/bitcoin tag$/i)).toBeInTheDocument();

    rerender(<PostTag label="bitcoin" count={16} />);
    expect(screen.getByLabelText(/bitcoin tag \(16 posts\)/i)).toBeInTheDocument();
  });

  it('preserves post-tag count selector for e2e tests', () => {
    render(<PostTag label="bitcoin" count={16} />);
    expect(screen.getByText('16')).toHaveAttribute('data-cy', 'post-tag-count');
  });

  it('preserves post-tag remove selector for e2e tests', () => {
    render(<PostTag label="bitcoin" showClose />);
    expect(screen.getByLabelText(/remove bitcoin tag/i)).toHaveAttribute('data-cy', 'post-tag-remove-btn');
  });

  it('renders with custom color', () => {
    const { container } = render(<PostTag label="bitcoin" color="#123456" />);
    const tag = screen.getByRole('button');

    // Verify the tag is rendered (custom color is applied via inline styles in the snapshot)
    expect(tag).toBeInTheDocument();
    expect(container.firstChild).toBeTruthy();
  });

  it('sets the night wash and the pastel day chip for the tag colour', () => {
    render(<PostTag label="bitcoin" color="#123456" />);
    const tag = screen.getByRole('button');
    const day = getTagDayPalette('#123456');

    expect(tag).toHaveClass('tag-palette', 'text-white', '[.light_&]:text-(--tag-label)');
    expect(tag.style.backgroundImage).toBe('var(--tag-fill)');
    expect(tag.style.getPropertyValue('--tag-night-fill')).toBe(
      'linear-gradient(90deg, rgba(5, 5, 10, 0.7) 0%, rgba(5, 5, 10, 0.7) 100%), linear-gradient(90deg, #123456 0%, #123456 100%)',
    );
    expect(tag.style.getPropertyValue('--tag-night-edge')).toBe('#123456');
    expect(tag.style.getPropertyValue('--tag-day-fill')).toBe(
      `linear-gradient(90deg, ${day.background} 0%, ${day.background} 100%)`,
    );
    expect(tag.style.getPropertyValue('--tag-day-edge')).toBe('#123456');
    expect(tag.style.getPropertyValue('--tag-day-label')).toBe(day.label);
  });

  it('draws the selected ring and border in the edge colour', () => {
    const { container } = render(<PostTag label="bitcoin" color="#123456" selected />);
    const tag = screen.getByRole('button');

    expect(tag).toHaveAttribute('aria-pressed', 'true');
    expect(tag.style.boxShadow).toBe('inset 0 0 0 1px var(--tag-edge)');
    const overlay = container.querySelector<HTMLElement>('.border-solid.absolute');
    expect(overlay?.style.borderColor).toBe('var(--tag-edge)');
  });
});
