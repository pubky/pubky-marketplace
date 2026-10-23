'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/atoms/Popover/Popover';
import { toggleVariants } from '@/atoms/Toggle/Toggle';
import { ToggleGroup, ToggleGroupItem } from '@/atoms/ToggleGroup/ToggleGroup';
import { REVIEW_FILTER_COPY } from '@/config/commerce-copy';
import type { MarketplaceReviewFilter } from '@/libs/commerce/review-filter';
import { cn } from '@/libs/utils/utils';
import { MarketplaceReviewTagPicker } from './MarketplaceReviewTagPicker';

export interface MarketplaceReviewFilterChipsProps {
  viewerPubky: string;
  filter: MarketplaceReviewFilter;
  onFilterChange: (filter: MarketplaceReviewFilter) => void;
}

const CHIP_CLASSES = 'h-8 rounded-full px-3 text-xs';
const CHIP_KINDS = ['all', 'following', 'wot'] as const;

/**
 * The reviewer chips of the review toolbar: All, People I follow and My
 * network are exclusive choices; "Tagged by me" opens a picker for the labels
 * and is the active chip while labels are applied. Choosing the active chip
 * again returns to All.
 */
export function MarketplaceReviewFilterChips({
  viewerPubky,
  filter,
  onFilterChange,
}: MarketplaceReviewFilterChipsProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const taggedLabels = filter.kind === 'tagged' ? filter.labels : [];

  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label={REVIEW_FILTER_COPY.label}
      data-testid="marketplace-reviews-filter"
    >
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={filter.kind === 'tagged' ? '' : filter.kind}
        onValueChange={(value) => {
          if (value === 'following' || value === 'wot') onFilterChange({ kind: value });
          else onFilterChange({ kind: 'all' });
        }}
      >
        {CHIP_KINDS.map((kind) => (
          <ToggleGroupItem
            key={kind}
            value={kind}
            className={CHIP_CLASSES}
            data-testid={`marketplace-reviews-filter-${kind}`}
          >
            {REVIEW_FILTER_COPY.chips[kind]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-pressed={filter.kind === 'tagged'}
            data-active={filter.kind === 'tagged'}
            className={cn(
              toggleVariants({ variant: 'outline', size: 'sm' }),
              CHIP_CLASSES,
              'data-[active=true]:bg-accent data-[active=true]:text-accent-foreground',
            )}
            data-testid="marketplace-reviews-filter-tagged"
          >
            {REVIEW_FILTER_COPY.chips.tagged}
            {taggedLabels.length > 0 && <span className="font-normal">· {taggedLabels.length}</span>}
            <ChevronDown aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6}>
          <MarketplaceReviewTagPicker
            viewerPubky={viewerPubky}
            labels={taggedLabels}
            onApply={(labels) => {
              onFilterChange({ kind: 'tagged', labels });
              setPickerOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
