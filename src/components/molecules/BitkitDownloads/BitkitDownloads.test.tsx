import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BitkitDownloads } from './BitkitDownloads';

describe('BitkitDownloads', () => {
  it('shows the label above the store badges when given one', () => {
    render(<BitkitDownloads compact label="Get Bitkit" />);

    expect(screen.getByText('Get Bitkit')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Get Bitkit' })).toBeInTheDocument();
  });

  it('shows the badges alone without a label', () => {
    render(<BitkitDownloads compact />);

    expect(screen.queryByText('Get Bitkit')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Get Bitkit' })).toBeInTheDocument();
  });
});
