'use client';

import { useRouter } from 'next/navigation';
import { MessageCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { type ChatRouteContext, getChatRoute } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { useRequireAuth } from '@/hooks/useRequireAuth/useRequireAuth';
import { useAuthStore } from '@/stores/auth/auth.store';

type ChatEntryButtonProps = {
  /** The other party of the conversation. */
  peerPubky: string;
  /** Listing or order the first message is about; shown as a chip in the thread. */
  context?: ChatRouteContext;
  label: string;
  variant?: 'default' | 'secondary' | 'ghost' | 'outline';
  size?: 'default' | 'sm' | 'lg';
  className?: string;
  icon?: ReactNode;
  dataCy?: string;
  dataTestId?: string;
};

/**
 * Opens the 1:1 conversation with `peerPubky`, asking for sign-in first.
 * Renders nothing when the viewer is the peer: nobody messages themselves.
 */
export function ChatEntryButton({
  peerPubky,
  context,
  label,
  variant = 'secondary',
  size = 'sm',
  className,
  icon,
  dataCy,
  dataTestId,
}: ChatEntryButtonProps) {
  const router = useRouter();
  const { requireAuth } = useRequireAuth();
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  if (currentUserPubky === peerPubky) return null;
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      data-cy={dataCy}
      data-testid={dataTestId}
      onClick={() => requireAuth(() => router.push(getChatRoute(peerPubky, context)))}
    >
      {icon ?? <MessageCircle className="size-4" aria-hidden="true" />}
      {label}
    </Button>
  );
}
