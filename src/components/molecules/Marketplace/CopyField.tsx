'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import { Typography } from '@/atoms/Typography/Typography';
import { toast } from '@/molecules/Toaster/use-toast';

type CopyFieldProps = {
  label: string;
  value: string;
  /** Text on the button; defaults to Copy. */
  copyLabel?: string;
  /** Shown instead of a toast title, for example "App URL copied". */
  copiedMessage?: string;
};

/** A read-only value the seller pastes somewhere else, with a Copy button. */
export function CopyField({ label, value, copyLabel = 'Copy', copiedMessage }: CopyFieldProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({ description: copiedMessage ?? `${label} copied.` });
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      toast({
        variant: 'error',
        description: `Could not copy. Select the ${label.toLowerCase()} and copy it by hand.`,
      });
    }
  };

  return (
    <div className="grid gap-1" data-testid="copy-field">
      <Typography as="span" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </Typography>
      <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-background px-3 py-2">
        <code className="min-w-0 flex-1 text-sm break-all" data-testid="copy-field-value">
          {value}
        </code>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="shrink-0 rounded-full"
          onClick={() => void copy()}
          aria-label={`${copyLabel} ${label}`}
        >
          {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
          {copied ? 'Copied' : copyLabel}
        </Button>
      </div>
    </div>
  );
}
