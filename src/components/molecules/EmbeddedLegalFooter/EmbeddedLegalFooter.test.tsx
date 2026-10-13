import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { setEmbedded } from '@/test-utils/embedded';
import { EmbeddedLegalFooter } from './EmbeddedLegalFooter';

describe('EmbeddedLegalFooter', () => {
  afterEach(() => setEmbedded(false));

  it('renders nothing in the top-level Shop', () => {
    render(<EmbeddedLegalFooter />);
    expect(screen.queryByTestId('embedded-legal-footer')).not.toBeInTheDocument();
  });

  it('names the contracting entity, the complaint contact and the way to report a listing when embedded', () => {
    setEmbedded(true);
    render(<EmbeddedLegalFooter />);

    const footer = screen.getByRole('contentinfo', { name: 'Legal' });
    expect(footer).toHaveTextContent('Pubky Shop is provided by Synonym Software, S.A. de C.V.');
    expect(screen.getByRole('link', { name: 'report@synonym.to' })).toHaveAttribute('href', 'mailto:report@synonym.to');
    expect(footer).toHaveTextContent('To report a listing, open it and choose Report listing.');
  });

  it('opens the Terms of Service in a dialog inside the frame', async () => {
    setEmbedded(true);
    const user = userEvent.setup();
    render(<EmbeddedLegalFooter />);

    await user.click(screen.getByText('Terms of Service'));

    expect(await screen.findByRole('dialog', { name: 'Terms of Service' })).toBeInTheDocument();
  });
});
