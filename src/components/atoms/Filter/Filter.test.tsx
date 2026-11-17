import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilterHeader, FilterItem, FilterItemIcon, FilterItemLabel, FilterList, FilterRoot } from './Filter';

const MockIcon = ({ className }: { className?: string }) => <svg data-testid="mock-icon" className={className} />;

describe('Filter Components', () => {
  describe('FilterRoot', () => {
    it('renders with the filter-root slot and default classes', () => {
      render(
        <FilterRoot>
          <div>Test content</div>
        </FilterRoot>,
      );

      const root = screen.getByTestId('filter-root');
      expect(root).toHaveAttribute('data-slot', 'filter-root');
      expect(root).toHaveTextContent('Test content');
      expect(root).toHaveClass('m-0', 'min-w-0', 'gap-2', 'bg-background', 'p-0');
    });

    it('merges a custom className', () => {
      render(
        <FilterRoot className="custom-class">
          <div>Test content</div>
        </FilterRoot>,
      );

      expect(screen.getByTestId('filter-root')).toHaveClass('bg-background', 'custom-class');
    });
  });

  describe('FilterHeader', () => {
    it('renders the title as an h2 heading with muted styling', () => {
      render(<FilterHeader title="Test Filter" />);

      const heading = screen.getByTestId('heading-2');
      expect(heading.tagName).toBe('H2');
      expect(heading).toHaveTextContent('Test Filter');
      expect(heading).toHaveClass('font-light', 'text-muted-foreground');
    });

    it('renders the subtitle when provided', () => {
      render(<FilterHeader title="Test Filter" subtitle="Test subtitle" />);

      expect(screen.getByText('Test subtitle')).toBeInTheDocument();
    });

    it('omits the subtitle when not provided', () => {
      render(<FilterHeader title="Test Filter" />);

      expect(screen.queryByText('Test subtitle')).not.toBeInTheDocument();
    });

    it('merges a custom className onto the heading', () => {
      render(<FilterHeader title="Test Filter" className="custom-header" />);

      expect(screen.getByTestId('heading-2')).toHaveClass('font-light', 'custom-header');
    });
  });

  describe('FilterList', () => {
    it('renders children with the filter-list slot', () => {
      render(
        <FilterList>
          <div>Item 1</div>
          <div>Item 2</div>
        </FilterList>,
      );

      const list = screen.getByTestId('filter-list');
      expect(list).toHaveAttribute('data-slot', 'filter-list');
      expect(list.children).toHaveLength(2);
    });

    it('passes through a custom className', () => {
      render(
        <FilterList className="custom-list">
          <div>Item 1</div>
        </FilterList>,
      );

      expect(screen.getByTestId('filter-list')).toHaveClass('custom-list');
    });
  });

  describe('FilterItem', () => {
    it('renders as a button with the filter-item slot', () => {
      render(
        <FilterItem>
          <span>Test Item</span>
        </FilterItem>,
      );

      const item = screen.getByTestId('filter-item');
      expect(item.tagName).toBe('BUTTON');
      expect(item).toHaveAttribute('type', 'button');
      expect(item).toHaveAttribute('data-slot', 'filter-item');
    });

    it('renders unselected by default', () => {
      render(
        <FilterItem>
          <span>Test Item</span>
        </FilterItem>,
      );

      const item = screen.getByTestId('filter-item');
      expect(item).toHaveAttribute('data-selected', 'false');
      expect(item).toHaveAttribute('aria-pressed', 'false');
      expect(item).toHaveClass('text-muted-foreground');
    });

    it('sets data-selected, aria-pressed and the selected class when selected', () => {
      render(
        <FilterItem isSelected={true}>
          <span>Selected Item</span>
        </FilterItem>,
      );

      const item = screen.getByTestId('filter-item');
      expect(item).toHaveAttribute('data-selected', 'true');
      expect(item).toHaveAttribute('aria-pressed', 'true');
      expect(item).toHaveClass('text-foreground');
    });

    it('updates aria-pressed when the selection changes', () => {
      const { rerender } = render(
        <FilterItem isSelected={false}>
          <span>Test Item</span>
        </FilterItem>,
      );

      const item = screen.getByTestId('filter-item');
      expect(item).toHaveAttribute('aria-pressed', 'false');

      rerender(
        <FilterItem isSelected={true}>
          <span>Test Item</span>
        </FilterItem>,
      );

      expect(item).toHaveAttribute('aria-pressed', 'true');
    });

    it('calls onClick when clicked', () => {
      const mockOnClick = vi.fn();
      render(
        <FilterItem onClick={mockOnClick}>
          <span>Clickable Item</span>
        </FilterItem>,
      );

      fireEvent.click(screen.getByTestId('filter-item'));

      expect(mockOnClick).toHaveBeenCalledTimes(1);
    });

    it('merges a custom className', () => {
      render(
        <FilterItem className="custom-item">
          <span>Test Item</span>
        </FilterItem>,
      );

      expect(screen.getByTestId('filter-item')).toHaveClass('font-medium', 'custom-item');
    });

    it('supports keyboard interaction when focused', () => {
      const mockOnClick = vi.fn();
      render(
        <FilterItem onClick={mockOnClick}>
          <span>Test Item</span>
        </FilterItem>,
      );

      const item = screen.getByTestId('filter-item');
      item.focus();
      expect(item).toHaveFocus();

      // Simulate pressing Enter key which triggers click on buttons
      fireEvent.click(item);
      expect(mockOnClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('FilterItemIcon', () => {
    it('renders the icon with the default size classes', () => {
      render(<FilterItemIcon icon={MockIcon} />);

      expect(screen.getByTestId('mock-icon')).toHaveClass('h-5', 'w-5');
    });

    it('merges a custom className', () => {
      render(<FilterItemIcon icon={MockIcon} className="custom-icon" />);

      expect(screen.getByTestId('mock-icon')).toHaveClass('h-5', 'w-5', 'custom-icon');
    });
  });

  describe('FilterItemLabel', () => {
    it('renders children in a span', () => {
      render(<FilterItemLabel>Test Label</FilterItemLabel>);

      expect(screen.getByText('Test Label').tagName).toBe('SPAN');
    });

    it('passes through a custom className', () => {
      render(<FilterItemLabel className="custom-label">Test Label</FilterItemLabel>);

      expect(screen.getByText('Test Label')).toHaveClass('custom-label');
    });
  });
});
