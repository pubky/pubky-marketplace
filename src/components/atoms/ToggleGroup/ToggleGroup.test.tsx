import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToggleGroup, ToggleGroupItem } from './ToggleGroup';

describe('ToggleGroup', () => {
  it('shows the chosen item as checked and reports a change of choice', async () => {
    const onValueChange = vi.fn();
    render(
      <ToggleGroup type="single" value="all" onValueChange={onValueChange} aria-label="Filter">
        <ToggleGroupItem value="all">All</ToggleGroupItem>
        <ToggleGroupItem value="following">Following</ToggleGroupItem>
      </ToggleGroup>,
    );

    expect(screen.getByRole('radio', { name: 'All' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Following' })).not.toBeChecked();

    await userEvent.click(screen.getByRole('radio', { name: 'Following' }));

    expect(onValueChange).toHaveBeenCalledWith('following');
  });

  it('applies the group variant and size to its items', () => {
    render(
      <ToggleGroup type="single" value="" variant="outline" size="sm">
        <ToggleGroupItem value="one">One</ToggleGroupItem>
      </ToggleGroup>,
    );

    expect(screen.getByRole('radio', { name: 'One' })).toHaveClass('border', 'h-8');
  });
});
