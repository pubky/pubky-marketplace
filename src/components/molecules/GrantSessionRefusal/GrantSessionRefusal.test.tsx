import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GrantSessionRefusal, grantSessionRefusalCopy } from './GrantSessionRefusal';

const view = vi.hoisted(() => ({ signer: null as 'bitkit' | 'passport' | null }));

vi.mock('@/hooks/useGrantSigner/useGrantSigner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useGrantSigner/useGrantSigner')>()),
  useGrantSigner: () => view.signer,
}));

describe('grantSessionRefusalCopy', () => {
  it('explains deployment unavailability without sending users to a cookie login', () => {
    expect(grantSessionRefusalCopy('default', 'bitkit')).toBe(
      'Marketplace approvals are unavailable on this deployment. Try again when access is enabled.',
    );
    expect(grantSessionRefusalCopy('default', 'passport')).toBe(
      'Marketplace approvals are unavailable on this deployment. Try again when access is enabled.',
    );
  });

  it('says messages are not available yet without sending the user to another signer', () => {
    for (const signer of ['bitkit', 'passport'] as const) {
      const copy = grantSessionRefusalCopy('messaging', signer);
      expect(copy).toMatch(/^New messages cannot be enabled with this (Bitkit|Pubky Passport) sign-in yet\./);
      expect(copy).not.toMatch(/Pubky Ring/);
    }
  });
});

describe('GrantSessionRefusal', () => {
  it('renders the copy for the signed-in grant signer', () => {
    view.signer = 'passport';
    render(<GrantSessionRefusal reason="messaging" />);

    expect(screen.getByTestId('grant-session-refusal')).toHaveTextContent(
      'New messages cannot be enabled with this Pubky Passport sign-in yet. You can still read saved conversations on this device.',
    );
  });

  it('does not assume Bitkit when no signer is known', () => {
    view.signer = null;
    render(<GrantSessionRefusal />);

    expect(screen.getByTestId('grant-session-refusal')).toHaveTextContent(
      'Marketplace approvals are unavailable on this deployment.',
    );
  });
});
