'use client';

import { ShieldAlert } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import { Typography } from '@/atoms/Typography/Typography';

/** The current address with `https:`, or `null` when there is no page address to rewrite. */
function httpsAddress(): string | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  url.protocol = 'https:';
  return url.toString();
}

/**
 * Full-screen state for a store opened outside a secure context (plain `http://` on a host other
 * than localhost). Signing in needs browser features that only work over HTTPS, so the store says
 * how to open it instead of offering a sign-in that cannot finish.
 */
export function StoreSecureContextScreen() {
  const href = httpsAddress();

  return (
    <Container
      overrideDefaults
      data-testid="store-secure-context-screen"
      className="flex min-h-screen w-full flex-col items-center justify-center gap-6 p-6"
    >
      <Container overrideDefaults className="flex shrink-0 items-center justify-center rounded-full bg-brand/16 p-6">
        <ShieldAlert className="size-12 text-brand" strokeWidth={1.5} />
      </Container>

      <Container overrideDefaults className="flex w-full max-w-md flex-col items-center justify-center gap-3">
        <Typography as="h1" size="lg" className="text-center leading-8">
          {'Open this store over HTTPS'}
        </Typography>
        <Typography as="p" className="text-center text-base leading-6 font-medium text-secondary-foreground">
          {
            'This store was opened over an insecure connection, so signing in and paying cannot work here. Open it at its https:// address.'
          }
        </Typography>
        <Typography as="p" className="text-center text-sm leading-5 text-muted-foreground">
          {
            'Running this store? Serve it over HTTPS with a domain and certificate or a tunnel. On the same machine, http://localhost also works.'
          }
        </Typography>
      </Container>

      {href && (
        <Button asChild>
          <a href={href}>{'Open over HTTPS'}</a>
        </Button>
      )}
    </Container>
  );
}
