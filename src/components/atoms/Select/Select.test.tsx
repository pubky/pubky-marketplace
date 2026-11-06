import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './Select';

// Mock DOM APIs not available in JSDOM that Radix Select requires
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
});

describe('Select', () => {
  it('renders with default props', () => {
    render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Select an option" />
        </SelectTrigger>
      </Select>,
    );
    const trigger = screen.getByRole('combobox');
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute('data-slot', 'select-trigger');
  });

  it('renders placeholder text', () => {
    render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Pick a fruit" />
        </SelectTrigger>
      </Select>,
    );
    expect(screen.getByText('Pick a fruit')).toBeInTheDocument();
  });

  it('renders trigger with default size', () => {
    render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Select" />
        </SelectTrigger>
      </Select>,
    );
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAttribute('data-size', 'default');
  });

  it('renders trigger with sm size', () => {
    render(
      <Select>
        <SelectTrigger size="sm">
          <SelectValue placeholder="Select" />
        </SelectTrigger>
      </Select>,
    );
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAttribute('data-size', 'sm');
  });

  it('renders disabled trigger', () => {
    render(
      <Select disabled>
        <SelectTrigger>
          <SelectValue placeholder="Select" />
        </SelectTrigger>
      </Select>,
    );
    const trigger = screen.getByRole('combobox');
    expect(trigger).toBeDisabled();
  });

  it('shows content when opened', () => {
    render(
      <Select open={true}>
        <SelectTrigger>
          <SelectValue placeholder="Select" />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value="apple">Apple</SelectItem>
          <SelectItem value="banana">Banana</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByText('Apple')).toBeInTheDocument();
    expect(screen.getByText('Banana')).toBeInTheDocument();
  });

  it('renders select items with correct data-slot', () => {
    render(
      <Select open={true}>
        <SelectTrigger>
          <SelectValue placeholder="Select" />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value="apple">Apple</SelectItem>
        </SelectContent>
      </Select>,
    );
    const item = document.querySelector('[data-slot="select-item"]');
    expect(item).toBeInTheDocument();
  });

  it('displays selected value in trigger when controlled', () => {
    const onValueChange = vi.fn();

    render(
      <Select value="apple" onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select a fruit" />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value="apple">Apple</SelectItem>
          <SelectItem value="banana">Banana</SelectItem>
        </SelectContent>
      </Select>,
    );

    // The selected value should be displayed in the trigger
    expect(screen.getByText('Apple')).toBeInTheDocument();
    // Placeholder should not be shown when a value is selected
    expect(screen.queryByText('Select a fruit')).not.toBeInTheDocument();
  });

  it('renders with a default value', () => {
    render(
      <Select defaultValue="banana">
        <SelectTrigger>
          <SelectValue placeholder="Select a fruit" />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value="apple">Apple</SelectItem>
          <SelectItem value="banana">Banana</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByText('Banana')).toBeInTheDocument();
  });

  it('renders disabled select item', () => {
    render(
      <Select open={true}>
        <SelectTrigger>
          <SelectValue placeholder="Select" />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value="apple" disabled>
            Apple
          </SelectItem>
        </SelectContent>
      </Select>,
    );
    const item = document.querySelector('[data-slot="select-item"]');
    expect(item).toHaveAttribute('data-disabled');
  });

  it('renders select content with correct data-slot', () => {
    render(
      <Select open={true}>
        <SelectTrigger>
          <SelectValue placeholder="Select" />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value="apple">Apple</SelectItem>
        </SelectContent>
      </Select>,
    );
    const content = document.querySelector('[data-slot="select-content"]');
    expect(content).toBeInTheDocument();
  });
});
