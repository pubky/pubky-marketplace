import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InputField } from './InputField';

describe('InputField', () => {
  it('renders with default props', () => {
    render(<InputField value="test value" />);

    const input = screen.getByTestId('input');
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('test value');
  });

  it('handles disabled state', () => {
    render(<InputField value="test" disabled={true} />);

    const input = screen.getByTestId('input');
    expect(input).toBeDisabled();
  });

  it('handles click events', () => {
    const handleClick = vi.fn();
    render(<InputField value="test" onClick={handleClick} />);

    const input = screen.getByTestId('input');
    fireEvent.click(input);

    expect(handleClick).toHaveBeenCalled();
  });

  it('handles paste events', () => {
    const handlePaste = vi.fn();
    render(<InputField value="test" onPaste={handlePaste} />);

    fireEvent.paste(screen.getByTestId('input'), {
      clipboardData: {
        getData: () => 'pasted value',
      },
    });

    expect(handlePaste).toHaveBeenCalled();
  });

  it('associates the validation message with the input for assistive technology', () => {
    render(<InputField id="amount" value="" status="error" message="Enter a valid amount." messageType="error" />);

    const input = screen.getByTestId('input');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'amount-message');
    expect(input).toHaveAccessibleDescription('Enter a valid amount.');
  });

  it('sets no describedby without a message or without an id', () => {
    const { rerender } = render(<InputField id="amount" value="" />);
    expect(screen.getByTestId('input')).not.toHaveAttribute('aria-describedby');

    rerender(<InputField value="" status="error" message="Enter a valid amount." messageType="error" />);
    expect(screen.getByTestId('input')).not.toHaveAttribute('aria-describedby');
  });
});
