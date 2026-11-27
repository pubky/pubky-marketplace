'use client';

import { BellRing, CalendarPlus, LoaderCircle } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import { Typography } from '@/atoms/Typography/Typography';
import { useCommerceShopFollow } from '@/hooks/useCommerceShopFollow/useCommerceShopFollow';
import { buildDropCalendarIcs } from '@/hooks/useMarketplaceDrop/drop-ics';
import type { CommerceDropRecord } from '@/libs/commerce/marketplace-records';
import type { MarketplacePublicDrop } from '@/services/marketplace/marketplace';

export interface DropRemindMeProps {
  record: CommerceDropRecord;
  /** Authoritative schedule when registered; the ICS uses it over the record. */
  projection: MarketplacePublicDrop | null;
  /** Absolute URL of this drop page for the calendar event. */
  dropUrl: string;
}

export function DropRemindMe({ record, projection, dropUrl }: DropRemindMeProps) {
  const follow = useCommerceShopFollow(record.ownerPubky);

  const downloadCalendarFile = () => {
    const startsAtIso = projection?.startsAt ?? record.startsAt;
    const endsAtIso = projection?.endsAt ?? record.endsAt ?? null;
    const ics = buildDropCalendarIcs({
      uid: `${record.ownerPubky}:${record.dropId}`,
      title: `Drop: ${record.title}`,
      description: `${record.title} starts. ${dropUrl}`,
      startsAtMs: Date.parse(startsAtIso),
      endsAtMs: endsAtIso ? Date.parse(endsAtIso) : null,
      url: dropUrl,
    });
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = `drop-${record.dropId}.ics`;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  };

  return (
    <section aria-label="Remind me" className="flex flex-col gap-3 rounded-md bg-card p-6">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" className="rounded-full" onClick={downloadCalendarFile}>
          <CalendarPlus className="size-4" />
          Add to calendar (.ics)
        </Button>
        <Button
          variant={follow.isFollowing ? 'default' : 'secondary'}
          size="sm"
          className="rounded-full"
          aria-pressed={follow.isFollowing}
          disabled={follow.isMutating}
          onClick={() => void follow.toggle()}
        >
          {follow.isMutating ? <LoaderCircle className="size-4 animate-spin" /> : <BellRing className="size-4" />}
          {follow.isFollowing ? 'Watching this seller' : 'Watch this seller'}
        </Button>
      </div>
      <Typography as="p" className="text-xs text-muted-foreground">
        The calendar alert fires from your own calendar
        {projection ? ' at the service-enforced start time' : ' at the seller’s stated start time (not yet registered)'}
        .
      </Typography>
    </section>
  );
}
