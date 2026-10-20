import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { InfoHint } from './InfoHint';

const TEXT = 'First short sentence. Second short sentence.';

function renderHint() {
  return render(
    <div>
      <InfoHint label="About this thing">{TEXT}</InfoHint>
      <button type="button">Elsewhere</button>
    </div>,
  );
}

describe('InfoHint', () => {
  it('is a labelled button that starts closed', () => {
    renderHint();
    const icon = screen.getByRole('button', { name: 'About this thing' });
    expect(icon).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(TEXT)).not.toBeInTheDocument();
  });

  it('opens on a mouse hover and closes when the mouse leaves', async () => {
    const user = userEvent.setup();
    renderHint();
    await user.hover(screen.getByRole('button', { name: 'About this thing' }));
    expect(await screen.findByText(TEXT)).toBeInTheDocument();
    await user.unhover(screen.getByRole('button', { name: 'About this thing' }));
    await waitFor(() => expect(screen.queryByText(TEXT)).not.toBeInTheDocument());
  });

  it('stays open when the mouse clicks the icon it just opened', async () => {
    const user = userEvent.setup();
    renderHint();
    const icon = screen.getByRole('button', { name: 'About this thing' });
    await user.hover(icon);
    await user.click(icon);
    await user.unhover(icon);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.getByText(TEXT)).toBeInTheDocument();
  });

  it('opens on a tap and closes on a second tap', async () => {
    const user = userEvent.setup();
    renderHint();
    const icon = screen.getByRole('button', { name: 'About this thing' });
    await user.pointer({ keys: '[TouchA]', target: icon });
    expect(await screen.findByText(TEXT)).toBeInTheDocument();
    await user.pointer({ keys: '[TouchA]', target: icon });
    await waitFor(() => expect(screen.queryByText(TEXT)).not.toBeInTheDocument());
  });

  it('opens from the keyboard with Enter and closes with Escape', async () => {
    const user = userEvent.setup();
    renderHint();
    await user.tab();
    expect(screen.getByRole('button', { name: 'About this thing' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText(TEXT)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText(TEXT)).not.toBeInTheDocument());
  });

  it('opens from the keyboard with Space', async () => {
    const user = userEvent.setup();
    renderHint();
    await user.tab();
    await user.keyboard(' ');
    expect(await screen.findByText(TEXT)).toBeInTheDocument();
  });

  it('can show a short visible label beside the icon', () => {
    render(
      <InfoHint label="About this thing" visibleLabel="About this thing">
        {TEXT}
      </InfoHint>,
    );
    expect(screen.getByRole('button', { name: 'About this thing' })).toHaveTextContent('About this thing');
  });
});
