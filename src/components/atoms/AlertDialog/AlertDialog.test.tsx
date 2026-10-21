import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './AlertDialog';

function Example({ onConfirm }: { onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger>Open</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sure?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Back</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Do it
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

describe('AlertDialog', () => {
  it('stays closed until opened, then names its title and description', async () => {
    const user = userEvent.setup();
    render(<Example onConfirm={vi.fn()} />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    await user.click(screen.getByText('Open'));

    expect(await screen.findByRole('alertdialog', { name: 'Sure?' })).toHaveAccessibleDescription(
      'This cannot be undone.',
    );
  });

  it('runs the action and closes', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<Example onConfirm={onConfirm} />);
    await user.click(screen.getByText('Open'));
    await user.click(await screen.findByRole('button', { name: 'Do it' }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('closes without running the action on cancel', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<Example onConfirm={onConfirm} />);
    await user.click(screen.getByText('Open'));
    await user.click(await screen.findByRole('button', { name: 'Back' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
