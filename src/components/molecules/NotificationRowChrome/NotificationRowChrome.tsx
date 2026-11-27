'use client';

import Link from 'next/link';
import { Typography } from '@/atoms/Typography/Typography';
import { AvatarWithFallback } from '@/organisms/AvatarWithFallback/AvatarWithFallback';

interface NotificationActorAvatarProps {
  avatarUrl?: string;
  userName: string;
  fallbackSeed: string;
  /** Wraps the avatar in a profile link when present. */
  userProfileLink: string | null;
}

export function NotificationActorAvatar({
  avatarUrl,
  userName,
  fallbackSeed,
  userProfileLink,
}: NotificationActorAvatarProps) {
  if (userProfileLink) {
    return (
      <a target="_top" href={userProfileLink} className="shrink-0 transition-opacity hover:opacity-80">
        <AvatarWithFallback
          avatarUrl={avatarUrl}
          name={userName}
          fallbackSeed={fallbackSeed}
          size="sm"
          className="lg:size-8"
        />
      </a>
    );
  }

  return (
    <AvatarWithFallback
      avatarUrl={avatarUrl}
      name={userName}
      fallbackSeed={fallbackSeed}
      size="sm"
      className="shrink-0 lg:size-8"
    />
  );
}

interface NotificationActorHeadingProps {
  userName: string;
  /** Makes the username a profile link when present. */
  userProfileLink: string | null;
  actionText: string;
  /** Makes the action text a link to the notification target when present. */
  actionLink?: string | null;
}

export function NotificationActorHeading({
  userName,
  userProfileLink,
  actionText,
  actionLink,
}: NotificationActorHeadingProps) {
  return (
    <Typography
      as="p"
      className="min-w-0 shrink text-sm leading-normal font-medium whitespace-normal text-foreground lg:flex lg:items-baseline lg:gap-1 lg:text-base lg:whitespace-nowrap"
    >
      {/* Username - truncated independently so long names do not overlap timestamp/icon */}
      {userProfileLink ? (
        <a
          target="_top"
          href={userProfileLink}
          className="inline-block max-w-full min-w-0 truncate align-bottom no-underline hover:no-underline"
        >
          {userName}
        </a>
      ) : (
        <span className="inline-block max-w-full min-w-0 truncate align-bottom">{userName}</span>
      )}{' '}
      {/* Action text - links to the notification target when there is one */}
      {actionLink ? (
        <Link href={actionLink} className="text-foreground hover:underline lg:shrink-0">
          {actionText}
        </Link>
      ) : (
        <span className="text-foreground lg:shrink-0">{actionText}</span>
      )}
    </Typography>
  );
}
