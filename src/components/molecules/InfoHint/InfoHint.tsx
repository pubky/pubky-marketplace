'use client';

import { useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/atoms/Popover/Popover';
import { Typography } from '@/atoms/Typography/Typography';
import { cn } from '@/libs/utils/utils';

const HOVER_CLOSE_DELAY_MS = 120;

export interface InfoHintProps {
  /** What the icon is for, read by screen readers: "About this sale". */
  label: string;
  /** Two or three short sentences, in plain words. */
  children: string;
  /** Shown beside the icon when the icon alone would sit stray, such as "About this sale". */
  visibleLabel?: string;
  className?: string;
  'data-testid'?: string;
}

/**
 * A small info icon with a short explanation. A mouse opens it on hover; a tap, Enter or Space
 * opens it for touch and keyboard users. Escape, a tap elsewhere or leaving the icon closes it.
 */
export function InfoHint({ label, children, visibleLabel, className, 'data-testid': testId }: InfoHintProps) {
  const [open, setOpen] = useState(false);
  const pinnedRef = useRef(false);
  const hoverOpenedRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };

  const handleOpenChange = (next: boolean) => {
    cancelClose();
    if (!next) {
      pinnedRef.current = false;
      hoverOpenedRef.current = false;
    }
    setOpen(next);
  };

  const hoverOpen = () => {
    cancelClose();
    if (open) return;
    hoverOpenedRef.current = true;
    setOpen(true);
  };

  const hoverClose = () => {
    if (pinnedRef.current) return;
    cancelClose();
    closeTimerRef.current = setTimeout(() => handleOpenChange(false), HOVER_CLOSE_DELAY_MS);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-testid={testId}
          className={cn(
            'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full text-muted-foreground',
            visibleLabel ? 'h-5 text-xs font-medium' : 'size-5',
            'transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden',
            className,
          )}
          onPointerEnter={(event) => {
            if (event.pointerType === 'mouse') hoverOpen();
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') hoverClose();
          }}
          onClick={(event) => {
            // A click on an icon the mouse has just opened keeps it open instead of closing it.
            if (hoverOpenedRef.current && !pinnedRef.current) {
              event.preventDefault();
              pinnedRef.current = true;
            }
          }}
        >
          <Info className="size-4" aria-hidden="true" />
          {visibleLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-72 max-w-[calc(100vw-2rem)] p-3"
        onMouseEnter={cancelClose}
        onMouseLeave={hoverClose}
      >
        <Typography as="p" size="sm" className="text-popover-foreground" data-testid="info-hint-content">
          {children}
        </Typography>
      </PopoverContent>
    </Popover>
  );
}
