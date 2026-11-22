import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NotFound } from './NotFound';

describe('NotFound', () => {
  it('renders the not-found message', () => {
    render(<NotFound />);

    expect(screen.getByRole('heading', { level: 2, name: 'Not Found' })).toBeInTheDocument();
    expect(screen.getByText('Could not find requested resource')).toBeInTheDocument();
  });
});
