'use client';

import { getUserProfileUrl } from '@/app/routes';
import { Container } from '@/atoms/Container/Container';
import { Typography } from '@/atoms/Typography/Typography';
import { getSocialHostUrl } from '@/config/social';
import { AvatarWithFallback } from '@/organisms/AvatarWithFallback/AvatarWithFallback';
import { useAuthStore } from '@/stores/auth/auth.store';

interface UserInfoPopoverHeaderProps {
  userId: string;
  userName: string;
  formattedPublicKey: string;
  avatarUrl?: string;
}

export function UserInfoPopoverHeader({ userId, userName, formattedPublicKey, avatarUrl }: UserInfoPopoverHeaderProps) {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const profileUrl = getSocialHostUrl(getUserProfileUrl(userId, currentUserPubky));

  return (
    <Container className="flex min-w-0 items-center gap-2" overrideDefaults>
      <a href={profileUrl} target="_top" onClick={(event) => event.stopPropagation()} className="shrink-0">
        <AvatarWithFallback avatarUrl={avatarUrl} name={userName} fallbackSeed={userId} size="md" />
      </a>
      <Container className="w-0 min-w-0 flex-1 items-start overflow-hidden">
        <a
          href={profileUrl}
          target="_top"
          onClick={(event) => event.stopPropagation()}
          className="block w-full min-w-0"
        >
          <Typography
            className="block w-full max-w-full cursor-pointer truncate text-sm leading-5 font-bold text-foreground"
            overrideDefaults
          >
            {userName}
          </Typography>
        </a>
        <Typography
          className="text-xs leading-4 font-medium tracking-[1.2px] text-muted-foreground uppercase"
          overrideDefaults
        >
          {formattedPublicKey}
        </Typography>
      </Container>
    </Container>
  );
}
