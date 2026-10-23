'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/atoms/Badge/Badge';
import { Button } from '@/atoms/Button/Button';
import { Input } from '@/atoms/Input/Input';
import { Typography } from '@/atoms/Typography/Typography';
import { REVIEW_FILTER_COPY } from '@/config/commerce-copy';
import { TAG_MAX_LENGTH } from '@/config/posts';
import { useViewerTagLabels } from '@/hooks/useViewerTagLabels/useViewerTagLabels';
import { MARKETPLACE_REVIEW_TAG_LABELS_MAX, normalizeReviewTagLabels } from '@/libs/commerce/review-filter';
import { sanitizeTagInput } from '@/libs/utils/utils';

export interface MarketplaceReviewTagPickerProps {
  viewerPubky: string;
  /** The labels the list is filtered by now. */
  labels: readonly string[];
  /** Applies the picked labels; none means "not filtered by tags". */
  onApply: (labels: string[]) => void;
}

/**
 * The "Tagged by me" picker: up to five labels (trimmed, lowercase, no
 * duplicates, as pubky.app stores them), typed or picked from the labels the
 * viewer already uses, applied together so one choice makes one request. It
 * mounts when its popover opens, so each opening starts from the applied
 * labels.
 */
export function MarketplaceReviewTagPicker({ viewerPubky, labels, onApply }: MarketplaceReviewTagPickerProps) {
  const [draft, setDraft] = useState<string[]>(() => normalizeReviewTagLabels(labels));
  const [entry, setEntry] = useState('');
  const suggestions = useViewerTagLabels(viewerPubky);
  const isFull = draft.length >= MARKETPLACE_REVIEW_TAG_LABELS_MAX;

  const addEntry = () => {
    setDraft((current) => normalizeReviewTagLabels([...current, entry]));
    setEntry('');
  };
  const toggle = (label: string) =>
    setDraft((current) =>
      current.includes(label)
        ? current.filter((candidate) => candidate !== label)
        : normalizeReviewTagLabels([...current, label]),
    );

  return (
    <div className="flex flex-col gap-3" data-testid="marketplace-review-tag-picker">
      <div className="flex flex-col gap-1">
        <Typography as="p" overrideDefaults className="text-sm font-medium text-foreground">
          {REVIEW_FILTER_COPY.tagged.title}
        </Typography>
        <Typography as="p" overrideDefaults className="text-xs text-muted-foreground">
          {REVIEW_FILTER_COPY.tagged.hint} {REVIEW_FILTER_COPY.tagged.limit(MARKETPLACE_REVIEW_TAG_LABELS_MAX)}
        </Typography>
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          addEntry();
        }}
      >
        <Input
          value={entry}
          onChange={(event) => setEntry(sanitizeTagInput(event.target.value))}
          maxLength={TAG_MAX_LENGTH}
          placeholder={REVIEW_FILTER_COPY.tagged.inputPlaceholder}
          aria-label={REVIEW_FILTER_COPY.tagged.inputLabel}
          disabled={isFull}
          data-testid="marketplace-review-tag-input"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={isFull || entry.trim().length === 0}>
          {REVIEW_FILTER_COPY.tagged.add}
        </Button>
      </form>
      {draft.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={REVIEW_FILTER_COPY.tagged.title}>
          {draft.map((label) => (
            <li key={label}>
              <Badge variant="secondary" className="gap-1 pr-1" data-testid="marketplace-review-tag-selected">
                {label}
                <button
                  type="button"
                  className="cursor-pointer rounded-full p-0.5 hover:bg-background/60"
                  aria-label={REVIEW_FILTER_COPY.tagged.remove(label)}
                  onClick={() => toggle(label)}
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {suggestions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Typography as="p" overrideDefaults className="text-xs font-medium text-muted-foreground">
            {REVIEW_FILTER_COPY.tagged.suggestionsHeading}
          </Typography>
          <ul className="flex flex-wrap gap-1.5">
            {suggestions.map((label) => (
              <li key={label}>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-full px-2.5 text-xs aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                  aria-pressed={draft.includes(label)}
                  disabled={isFull && !draft.includes(label)}
                  onClick={() => toggle(label)}
                  data-testid="marketplace-review-tag-suggestion"
                >
                  {label}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => onApply([])}>
          {REVIEW_FILTER_COPY.tagged.clear}
        </Button>
        <Button type="button" size="sm" onClick={() => onApply(draft)} data-testid="marketplace-review-tag-apply">
          {REVIEW_FILTER_COPY.tagged.apply}
        </Button>
      </div>
    </div>
  );
}
