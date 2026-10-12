import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GrantSessionRefusal, grantSessionRefusalCopy } from './GrantSessionRefusal';

const view = vi.hoisted(() => ({ signer: null as 'bitkit' | 'passport' | null }));

vi.mock('@/hooks/useGrantSigner/useGrantSigner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useGrantSigner/useGrantSigner')>()),
  useGrantSigner: () => view.signer,
}));

describe('grantSessionRefusalCopy', () => {
  it('names the signer that approved the sign-in', () => {
    expect(grantSessionRefusalCopy('bitkit')).toBe(
      'Bitkit sign-in does not cover this step yet. Sign in with Pubky Ring to continue.',
    );
    expect(grantSessionRefusalCopy('passport')).toBe(
      'Pubky Passport sign-in does not cover this step yet. Sign in with Pubky Ring to continue.',
    );
  });
});

describe('GrantSessionRefusal', () => {
  it('renders the copy for the signed-in grant signer', () => {
    view.signer = 'passport';
    render(<GrantSessionRefusal />);

    expect(screen.getByTestId('grant-session-refusal')).toHaveTextContent(
      'Pubky Passport sign-in does not cover this step yet.',
    );
  });

  it('falls back to Bitkit copy when no grant signer is known', () => {
    view.signer = null;
    render(<GrantSessionRefusal />);

    expect(screen.getByTestId('grant-session-refusal')).toHaveTextContent(
      'Bitkit sign-in does not cover this step yet.',
    );
  });
});
