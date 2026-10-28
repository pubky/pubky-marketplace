import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RadioGroup, RadioGroupItem } from './RadioGroup';

const renderRadioGroup = (props?: { onValueChange?: (value: string) => void; defaultValue?: string }) =>
  render(
    <RadioGroup {...props}>
      <RadioGroupItem value="one" label="One" />
      <RadioGroupItem value="two" label="Two" />
    </RadioGroup>,
  );

describe('RadioGroup', () => {
  it('renders two radios', () => {
    renderRadioGroup();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('selects an item when clicked and reports the value', () => {
    const handleValueChange = vi.fn();
    renderRadioGroup({ onValueChange: handleValueChange });

    fireEvent.click(screen.getByLabelText('Two'));

    expect(handleValueChange).toHaveBeenCalledWith('two');
    expect(screen.getByLabelText('Two')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('One')).toHaveAttribute('aria-checked', 'false');
  });

  it('enforces mutual exclusivity', () => {
    renderRadioGroup({ defaultValue: 'one' });

    expect(screen.getByLabelText('One')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Two')).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(screen.getByLabelText('Two'));

    expect(screen.getByLabelText('One')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByLabelText('Two')).toHaveAttribute('aria-checked', 'true');
  });

  it('clicking the label selects the radio', () => {
    const handleValueChange = vi.fn();
    renderRadioGroup({ onValueChange: handleValueChange });

    fireEvent.click(screen.getByText('One'));

    expect(handleValueChange).toHaveBeenCalledWith('one');
  });

  it('renders a standalone item without label/description', () => {
    render(
      <RadioGroup defaultValue="solo">
        <RadioGroupItem value="solo" />
      </RadioGroup>,
    );
    expect(screen.getByRole('radio')).toBeInTheDocument();
  });
});

describe('RadioGroup - Rendering', () => {
  it('applies the group layout classes', () => {
    const { container } = renderRadioGroup();
    expect(container.querySelector('[role="radiogroup"]')).toHaveClass('grid', 'gap-3');
  });

  it('applies the item base classes', () => {
    renderRadioGroup();
    expect(screen.getAllByRole('radio')[0]).toHaveClass('peer', 'size-4', 'rounded-full', 'border', 'border-input');
  });

  it('sets data-state from the checked state', () => {
    renderRadioGroup({ defaultValue: 'one' });
    expect(screen.getByLabelText('One')).toHaveAttribute('data-state', 'checked');
    expect(screen.getByLabelText('Two')).toHaveAttribute('data-state', 'unchecked');
  });

  it('renders the description when provided', () => {
    render(
      <RadioGroup defaultValue="one">
        <RadioGroupItem value="one" label="One" description="The first option" />
      </RadioGroup>,
    );
    expect(screen.getByText('The first option')).toBeInTheDocument();
  });

  it('does not render a box wrapper for the default variant', () => {
    const { container } = render(
      <RadioGroup defaultValue="one">
        <RadioGroupItem value="one" label="One" />
      </RadioGroup>,
    );
    expect(container.querySelector('.rounded-lg')).not.toBeInTheDocument();
  });

  it('wraps the item in a bordered card for the box variant', () => {
    const { container } = render(
      <RadioGroup defaultValue="starter">
        <RadioGroupItem value="starter" label="Starter Plan" description="Perfect for small businesses" variant="box" />
      </RadioGroup>,
    );
    const box = container.querySelector('.rounded-lg');
    expect(box).toHaveClass('rounded-lg', 'border', 'border-border', 'p-4');
    expect(box).toContainElement(screen.getByRole('radio'));
  });

  it('is disabled when the item is disabled', () => {
    render(
      <RadioGroup>
        <RadioGroupItem value="one" label="One" disabled />
      </RadioGroup>,
    );
    expect(screen.getByRole('radio')).toBeDisabled();
  });
});
