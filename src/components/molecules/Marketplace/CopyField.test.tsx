import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/molecules/Toaster/use-toast';
import { CopyField } from './CopyField';

vi.mock('@/molecules/Toaster/use-toast', () => ({ toast: vi.fn() }));

describe('CopyField', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the value and copies it', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<CopyField label="App URL" value="https://api.example/launch" copiedMessage="App URL copied." />);

    expect(screen.getByTestId('copy-field-value')).toHaveTextContent('https://api.example/launch');
    await user.click(screen.getByRole('button', { name: 'Copy App URL' }));

    expect(writeText).toHaveBeenCalledWith('https://api.example/launch');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy App URL' })).toHaveTextContent('Copied'));
    expect(toast).toHaveBeenCalledWith({ description: 'App URL copied.' });
  });

  it('names the button after the field, and supports Copy all', () => {
    render(<CopyField label="Scopes" value="a, b" copyLabel="Copy all" />);
    expect(screen.getByRole('button', { name: 'Copy all Scopes' })).toHaveTextContent('Copy all');
  });

  it('says so when the browser refuses to copy', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    render(<CopyField label="App URL" value="https://api.example/launch" />);

    await user.click(screen.getByRole('button', { name: 'Copy App URL' }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        variant: 'error',
        description: 'Could not copy. Select the app url and copy it by hand.',
      }),
    );
  });
});
