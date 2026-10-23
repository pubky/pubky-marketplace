import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Label } from './Label';

describe('Label', () => {
  it('renders a <label> with the label data-slot by default', () => {
    render(<Label>Default Label</Label>);
    const label = screen.getByText('Default Label');
    expect(label.tagName).toBe('LABEL');
    expect(label).toHaveAttribute('data-slot', 'label');
  });

  it('applies the base classes', () => {
    render(<Label>Label</Label>);
    expect(screen.getByText('Label')).toHaveClass('flex', 'items-center', 'gap-2', 'text-sm', 'font-medium');
  });

  it('merges a custom className with the base classes', () => {
    render(<Label className="custom-label">Label</Label>);
    expect(screen.getByText('Label')).toHaveClass('text-sm', 'font-medium', 'custom-label');
  });

  it('passes through htmlFor', () => {
    render(<Label htmlFor="test-input">Form Label</Label>);
    expect(screen.getByText('Form Label')).toHaveAttribute('for', 'test-input');
  });

  it('associates with a form control via htmlFor', () => {
    render(
      <div>
        <Label htmlFor="username">Username</Label>
        <input id="username" type="text" />
      </div>,
    );
    expect(screen.getByLabelText('Username')).toBe(screen.getByRole('textbox'));
  });

  it('renders complex children', () => {
    render(
      <Label>
        <span>Complex Label</span>
      </Label>,
    );
    expect(screen.getByText('Complex Label').tagName).toBe('SPAN');
  });
});
