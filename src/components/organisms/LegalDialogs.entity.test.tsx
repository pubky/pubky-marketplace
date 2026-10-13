import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LEGAL_ENTITY_NAME } from '@/config/legal';
import { DialogPrivacy } from './DialogPrivacy/DialogPrivacy';
import { DialogTerms } from './DialogTerms/DialogTerms';

describe('the contracting entity in the legal dialogs', () => {
  it.each([
    ['Terms of Service', <DialogTerms key="terms" />],
    ['Privacy Policy', <DialogPrivacy key="privacy" />],
  ])('%s names %s only through LEGAL_ENTITY_NAME', async (name, element) => {
    const user = userEvent.setup();
    render(element);

    await user.click(screen.getByRole('button', { name }));
    const dialog = await screen.findByRole('dialog', { name });

    expect(dialog).toHaveTextContent(LEGAL_ENTITY_NAME);
    expect(dialog).not.toHaveTextContent('Synonym Software Ltd');
    expect(within(dialog).queryByText(/S\.A\. DE C\.V\./)).not.toBeInTheDocument();
  });
});
