import { useId } from 'react';
import { Label } from '@/atoms/Label/Label';
import { FORM_LABEL_CLASSES } from '@/config/forms';
import { MarketplaceStarRating } from '@/molecules/MarketplaceStarRating/MarketplaceStarRating';

export interface MarketplaceStarRatingInputProps {
  /** The chosen stars as "1".."5", or "" while unrated. */
  value: string;
  onChange: (value: string) => void;
  /** The visible label, also the radio group's accessible name. */
  label?: string;
  /** The error shown under the stars. */
  error?: string;
}

/**
 * A one-to-five star radio group. Each group needs its own radio `name` so
 * several of them can share a form; an unrated group keeps its first star
 * in the tab order so the keyboard can reach it.
 */
export function MarketplaceStarRatingInput({
  value,
  onChange,
  label = 'Rating',
  error,
}: MarketplaceStarRatingInputProps) {
  const groupName = useId();
  return (
    <div className="grid gap-2">
      <Label className={FORM_LABEL_CLASSES}>{label}</Label>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {[1, 2, 3, 4, 5].map((rating) => {
          const ratingValue = String(rating);
          const tabbable = value === ratingValue || (value === '' && rating === 1);
          return (
            <label
              key={ratingValue}
              className="relative cursor-pointer rounded-full border border-border/70 px-3 py-2 transition-colors has-[:checked]:border-brand has-[:checked]:bg-brand/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2"
            >
              <input
                type="radio"
                name={groupName}
                value={ratingValue}
                checked={value === ratingValue}
                tabIndex={tabbable ? 0 : -1}
                onChange={() => onChange(ratingValue)}
                aria-label={`${rating} ${rating === 1 ? 'star' : 'stars'}`}
                className="sr-only"
              />
              <span aria-hidden="true">
                <MarketplaceStarRating rating={rating} size="sm" />
              </span>
            </label>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
