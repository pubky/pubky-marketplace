import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GrantSessionRefusal, grantSessionRefusalCopy } from './GrantSessionRefusal';

const view = vi.hoisted(() => ({ signer: null as 'bitkit' | 'passport' | null }));

vi.mock('@/hooks/useGrantSigner/useGrantSigner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useGrantSigner/useGrantSigner')>()),
  useGrantSigner: () => view.signer,
}));

describe('grantSessionRefusalCopy', () => {
  it('explains deployment unavailability without naming a signer or a cookie login', () => {
    expect(grantSessionRefusalCopy()).toBe(
      'Marketplace approvals are unavailable on this deployment. Try again when access is enabled.',
    );
  });
});

describe('GrantSessionRefusal', () => {
  it('renders the deployment copy whatever the signer', () => {
    view.signer = 'passport';
    render(<GrantSessionRefusal />);

    expect(screen.getByTestId('grant-session-refusal')).toHaveTextContent(
      'Marketplace approvals are unavailable on this deployment. Try again when access is enabled.',
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
