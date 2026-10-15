'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { Typography } from '@/atoms/Typography/Typography';
import { CommerceController } from '@/controllers/commerce/commerce';
import { FileController } from '@/controllers/file/file';
import { useUserDetails } from '@/hooks/useUserDetails/useUserDetails';
import { cn } from '@/libs/utils/utils';
import { AvatarWithFallback } from '@/organisms/AvatarWithFallback/AvatarWithFallback';

/** A peer's best display name: their shop name, else their profile name, else a short pubky. */
export function useChatPeerName(peerPubky: string): {
  name: string;
  avatarUrl: string | undefined;
  isLoading: boolean;
} {
  const { userDetails, isLoading } = useUserDetails(peerPubky);
  const shop = useLiveQuery(() => CommerceController.getShop(peerPubky), [peerPubky]);
  const name = shop?.record.name ?? userDetails?.name ?? `${peerPubky.slice(0, 8)}…${peerPubky.slice(-4)}`;
  const avatarUrl = userDetails?.image ? FileController.getAvatarUrl(peerPubky) : undefined;
  return { name, avatarUrl, isLoading: isLoading && !shop };
}

export function ChatPeerIdentity({
  peerPubky,
  size = 'md',
  className,
  subtitle,
}: {
  peerPubky: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  subtitle?: string;
}) {
  const { name, avatarUrl } = useChatPeerName(peerPubky);
  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)}>
      <AvatarWithFallback avatarUrl={avatarUrl} name={name} fallbackSeed={peerPubky} size={size} alt={name} />
      <div className="flex min-w-0 flex-col">
        <Typography as="span" size="sm" className="truncate font-bold">
          {name}
        </Typography>
        {subtitle ? (
          <Typography as="span" size="xs" className="truncate text-muted-foreground">
            {subtitle}
          </Typography>
        ) : null}
      </div>
    </div>
  );
}
