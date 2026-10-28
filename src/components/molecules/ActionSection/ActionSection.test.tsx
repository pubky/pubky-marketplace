import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActionSection } from './ActionSection';

describe('ActionSection', () => {
  it('renders with actions', () => {
    const mockAction = vi.fn();
    const actions = [
      { label: 'Continue', onClick: mockAction, variant: 'default' as const },
      { label: 'Back', onClick: mockAction, variant: 'outline' as const },
    ];

    render(<ActionSection actions={actions} />);

    const continueButton = screen.getByRole('button', { name: 'Continue' });
    const backButton = screen.getByRole('button', { name: 'Back' });

    expect(continueButton).toBeInTheDocument();
    expect(continueButton).toHaveTextContent('Continue');
    expect(backButton).toBeInTheDocument();
    expect(backButton).toHaveTextContent('Back');
  });

  it('defaults actions to the secondary variant and forwards id, icon, className, disabled and clicks', () => {
    const onSave = vi.fn();
    render(
      <ActionSection
        actions={[
          { id: 'save', label: 'Save', onClick: onSave, icon: <svg data-testid="save-icon" />, className: 'w-40' },
          { label: 'Delete', onClick: vi.fn(), disabled: true },
        ]}
      >
        <p>Section body</p>
      </ActionSection>,
    );

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toHaveAttribute('id', 'save');
    expect(save).toHaveAttribute('data-variant', 'secondary');
    expect(save).toHaveClass('rounded-full', 'w-40');
    expect(save).toContainElement(screen.getByTestId('save-icon'));
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByText('Section body')).toBeInTheDocument();

    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('renders only the children when there are no actions', () => {
    render(
      <ActionSection>
        <p>Section body</p>
      </ActionSection>,
    );

    expect(screen.getByText('Section body')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
