import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Input } from './Input';

describe('Input', () => {
  it('accepts and displays value', () => {
    render(<Input data-testid="input" value="test value" onChange={() => {}} />);
    const input = screen.getByTestId('input') as HTMLInputElement;

    expect(input.value).toBe('test value');
  });

  it('handles disabled state', () => {
    render(<Input data-testid="input" disabled />);
    const input = screen.getByTestId('input');

    expect(input).toBeDisabled();
  });

  it('handles onClick events', () => {
    const handleClick = vi.fn();
    render(<Input data-testid="input" onClick={handleClick} />);
    const input = screen.getByTestId('input');

    fireEvent.click(input);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('handles onChange events', () => {
    const handleChange = vi.fn();
    render(<Input data-testid="input" onChange={handleChange} />);
    const input = screen.getByTestId('input');

    fireEvent.change(input, { target: { value: 'new value' } });
    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  it('handles onFocus and onBlur events', () => {
    const handleFocus = vi.fn();
    const handleBlur = vi.fn();
    render(<Input data-testid="input" onFocus={handleFocus} onBlur={handleBlur} />);
    const input = screen.getByTestId('input');

    fireEvent.focus(input);
    expect(handleFocus).toHaveBeenCalledTimes(1);

    fireEvent.blur(input);
    expect(handleBlur).toHaveBeenCalledTimes(1);
  });

  it('forwards ref correctly', () => {
    const ref = vi.fn();
    render(<Input ref={ref} data-testid="input" />);

    expect(ref).toHaveBeenCalledWith(expect.any(HTMLInputElement));
  });
});

describe('Input - Rendering', () => {
  it('renders with type text and the base classes by default', () => {
    render(<Input />);
    const input = screen.getByTestId('input');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveClass('flex', 'h-9', 'w-full', 'rounded-md', 'border', 'border-input', 'bg-background');
  });

  it.each(['text', 'email', 'password', 'number', 'search'] as const)('renders with type="%s"', (type) => {
    render(<Input type={type} />);
    expect(screen.getByTestId('input')).toHaveAttribute('type', type);
  });

  it('applies the outline theme classes', () => {
    render(<Input theme="outline" />);
    expect(screen.getByTestId('input')).toHaveClass('border-input');
  });

  it('applies the dashed theme classes', () => {
    render(<Input theme="dashed" />);
    const input = screen.getByTestId('input');
    expect(input).toHaveClass('rounded-md', 'border', 'border-dashed', 'border-border', 'font-medium');
    expect(input).toHaveClass('h-12', 'px-5', 'shadow-none');
  });

  it('merges a custom className with the base classes', () => {
    render(<Input className="custom-input" />);
    expect(screen.getByTestId('input')).toHaveClass('rounded-md', 'custom-input');
  });

  it('passes through placeholder', () => {
    render(<Input placeholder="Enter text" />);
    expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument();
  });

  it('is required when required', () => {
    render(<Input required />);
    expect(screen.getByTestId('input')).toBeRequired();
  });

  it('is readOnly when readOnly', () => {
    render(<Input readOnly />);
    expect(screen.getByTestId('input')).toHaveAttribute('readonly');
  });

  it('passes through standard input attributes', () => {
    render(
      <Input
        id="test-input"
        name="testName"
        required
        maxLength={100}
        minLength={5}
        pattern="[a-z]+"
        autoComplete="off"
      />,
    );
    const input = screen.getByTestId('input');
    expect(input).toHaveAttribute('id', 'test-input');
    expect(input).toHaveAttribute('name', 'testName');
    expect(input).toHaveAttribute('maxlength', '100');
    expect(input).toHaveAttribute('minlength', '5');
    expect(input).toHaveAttribute('pattern', '[a-z]+');
    expect(input).toHaveAttribute('autocomplete', 'off');
  });
});
