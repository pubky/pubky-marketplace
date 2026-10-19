import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DialogAge } from './DialogAge/DialogAge';
import { DialogPrivacy } from './DialogPrivacy/DialogPrivacy';
import { DialogTerms } from './DialogTerms/DialogTerms';

const LEGAL_DIALOGS = [
  { name: 'Terms of Service', element: <DialogTerms />, dialogName: 'Terms of Service' },
  { name: 'Privacy Policy', element: <DialogPrivacy />, dialogName: 'Privacy Policy' },
  { name: 'over 18 years old.', element: <DialogAge />, dialogName: 'Age minimum: 18' },
];

describe.each(LEGAL_DIALOGS)('$name link', ({ name, element, dialogName }) => {
  it('is a button reached by Tab alone', async () => {
    const user = userEvent.setup();
    render(element);

    await user.tab();

    const trigger = screen.getByRole('button', { name });
    expect(trigger).toHaveFocus();
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('type', 'button');
  });

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('opens its dialog with %s', async (_key, keys) => {
    const user = userEvent.setup();
    render(element);

    await user.tab();
    await user.keyboard(keys);

    expect(await screen.findByRole('dialog', { name: dialogName })).toBeInTheDocument();
  });

  it('opens its dialog on click', async () => {
    const user = userEvent.setup();
    render(element);

    await user.click(screen.getByRole('button', { name }));

    expect(await screen.findByRole('dialog', { name: dialogName })).toBeInTheDocument();
  });
});
