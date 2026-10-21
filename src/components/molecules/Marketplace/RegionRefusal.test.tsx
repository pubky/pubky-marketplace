import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RegionRefusal } from './RegionRefusal';

describe('RegionRefusal', () => {
  it('says why in the error treatment, as an alert with an icon', () => {
    const { container } = render(
      <RegionRefusal message="Not available to buyers in the EU or UK" testId="x-refusal" />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toBe(screen.getByTestId('x-refusal'));
    expect(alert).toHaveTextContent('Not available to buyers in the EU or UK');
    expect(alert.className).toContain('border-destructive');
    expect(alert.className).toContain('bg-destructive');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
