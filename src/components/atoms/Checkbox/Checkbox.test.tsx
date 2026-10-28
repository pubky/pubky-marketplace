import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('renders with default props', () => {
    render(<Checkbox />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeInTheDocument();
  });

  it('handles onCheckedChange callback', () => {
    const handleChange = vi.fn();
    render(<Checkbox onCheckedChange={handleChange} />);

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  it('clicking label toggles checkbox', () => {
    const handleChange = vi.fn();
    render(<Checkbox label="Toggle me" onCheckedChange={handleChange} />);

    const label = screen.getByText('Toggle me');
    fireEvent.click(label);

    expect(handleChange).toHaveBeenCalledTimes(1);
  });
});

describe('Checkbox - Rendering', () => {
  it('applies the base classes', () => {
    render(<Checkbox />);
    expect(screen.getByRole('checkbox')).toHaveClass('peer', 'h-4', 'w-4', 'rounded', 'border', 'border-input');
  });

  it('is unchecked by default', () => {
    render(<Checkbox />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toHaveAttribute('data-state', 'unchecked');
    expect(checkbox).toHaveAttribute('aria-checked', 'false');
  });

  it('sets data-state and aria-checked when checked', () => {
    render(<Checkbox checked={true} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toHaveAttribute('data-state', 'checked');
    expect(checkbox).toHaveAttribute('aria-checked', 'true');
  });

  it('is disabled when disabled', () => {
    render(<Checkbox disabled />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('associates the label with the checkbox via htmlFor', () => {
    render(<Checkbox label="Test label" />);
    const checkbox = screen.getByRole('checkbox');
    const label = screen.getByText('Test label');
    expect(label.tagName).toBe('LABEL');
    expect(label).toHaveAttribute('for', checkbox.id);
    expect(checkbox.id).not.toBe('');
  });

  it('uses a provided id for the label association', () => {
    render(<Checkbox id="custom-checkbox" label="Test label" />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('id', 'custom-checkbox');
    expect(screen.getByText('Test label')).toHaveAttribute('for', 'custom-checkbox');
  });

  it('renders the description when provided', () => {
    render(<Checkbox label="Label" description="Description text" />);
    expect(screen.getByText('Description text')).toBeInTheDocument();
  });

  it('renders no label or description elements without the props', () => {
    const { container } = render(<Checkbox />);
    expect(container.querySelector('label')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('merges a custom className with the base classes', () => {
    render(<Checkbox className="custom-checkbox" />);
    expect(screen.getByRole('checkbox')).toHaveClass('h-4', 'w-4', 'custom-checkbox');
  });
});
