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

describe('InputField - Loading state', () => {
  it('shows the spinner and default loading text, disables the input and hides the icon', () => {
    render(<InputField value="typed" loading icon={<span data-testid="field-icon" />} />);

    const input = screen.getByTestId('input');
    expect(screen.getByTestId('loading-icon')).toBeInTheDocument();
    expect(input).toHaveValue('Loading...');
    expect(input).toBeDisabled();
    expect(input.parentElement).toHaveClass('border-brand', 'text-brand');
    expect(screen.queryByTestId('field-icon')).not.toBeInTheDocument();
  });

  it('uses a custom loading text and icon', () => {
    render(
      <InputField value="typed" loading loadingText="Checking..." loadingIcon={<span data-testid="custom-loader" />} />,
    );

    expect(screen.getByTestId('input')).toHaveValue('Checking...');
    expect(screen.getByTestId('custom-loader')).toBeInTheDocument();
    expect(screen.queryByTestId('loading-icon')).not.toBeInTheDocument();
  });

  it('shows the real value and no spinner when not loading', () => {
    render(<InputField value="typed" icon={<span data-testid="field-icon" />} />);

    expect(screen.getByTestId('input')).toHaveValue('typed');
    expect(screen.getByTestId('input')).toBeEnabled();
    expect(screen.queryByTestId('loading-icon')).not.toBeInTheDocument();
    expect(screen.getByTestId('field-icon')).toBeInTheDocument();
  });
});

describe('InputField - Icon placement', () => {
  it('places the icon before the input by default with left padding and forwards icon clicks', () => {
    const onClickIcon = vi.fn();
    render(<InputField value="" icon={<span data-testid="field-icon" />} onClickIcon={onClickIcon} />);

    const input = screen.getByTestId('input');
    const iconWrapper = screen.getByTestId('field-icon').parentElement!;
    expect(input.parentElement).toHaveClass('pl-4.5');
    expect(iconWrapper.nextElementSibling).toBe(input);
    expect(iconWrapper).not.toHaveClass('mr-5');

    fireEvent.click(screen.getByTestId('field-icon'));
    expect(onClickIcon).toHaveBeenCalledTimes(1);
  });

  it('places the icon after the input for iconPosition="right"', () => {
    const onClickIcon = vi.fn();
    render(
      <InputField value="" icon={<span data-testid="field-icon" />} iconPosition="right" onClickIcon={onClickIcon} />,
    );

    const input = screen.getByTestId('input');
    const iconWrapper = screen.getByTestId('field-icon').parentElement!;
    expect(input.parentElement).toHaveClass('pl-2');
    expect(input.parentElement).not.toHaveClass('pl-4.5');
    expect(input.nextElementSibling).toBe(iconWrapper);
    expect(iconWrapper).toHaveClass('mr-5');

    fireEvent.click(screen.getByTestId('field-icon'));
    expect(onClickIcon).toHaveBeenCalledTimes(1);
  });

  it('uses the narrow padding without an icon', () => {
    render(<InputField value="" />);

    expect(screen.getByTestId('input').parentElement).toHaveClass('pl-2');
  });
});

describe('InputField - Variants', () => {
  it.each([
    { size: 'sm' as const, classes: ['h-10', 'text-sm'] },
    { size: 'md' as const, classes: ['h-12', 'text-base'] },
    { size: 'lg' as const, classes: ['h-14', 'text-lg'] },
  ])('applies the $size size', ({ size, classes }) => {
    render(<InputField value="" size={size} />);

    expect(screen.getByTestId('input').parentElement).toHaveClass(...classes);
  });

  it('applies status, dashed variant and message type classes', () => {
    const { rerender } = render(
      <InputField value="" status="success" variant="dashed" message="Looks good" messageType="success" />,
    );
    const wrapper = screen.getByTestId('input').parentElement;
    expect(wrapper).toHaveClass('border-brand', 'text-brand', 'border-dashed');
    expect(screen.getByTestId('input')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByText('Looks good')).toHaveClass('text-brand');

    rerender(<InputField value="" status="error" message="Nope" messageType="alert" />);
    expect(screen.getByTestId('input').parentElement).toHaveClass('border-red-500', 'text-red-500');
    expect(screen.getByTestId('input').parentElement).not.toHaveClass('border-dashed');
    expect(screen.getByText('Nope')).toHaveClass('text-yellow-500');
  });
});
