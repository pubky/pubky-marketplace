import { ExternalLink } from 'lucide-react';
import { Link } from '@/atoms/Link/Link';
import { ARBISCAN_LOOKUP_LABEL, type ArbiscanLookupKind, arbiscanUrl } from '@/libs/commerce/arbiscan';
import { cn } from '@/libs/utils/utils';

/**
 * A lookup link to Arbiscan for a USDT refund's transaction hash or address.
 * It renders nothing for a value that is not a well-formed hash or address, so
 * seller-supplied text never becomes part of a URL. The link only opens a
 * public explorer page; the Shop itself never checks the transfer.
 */
export function ArbiscanLookupLink({
  kind,
  value,
  className,
}: {
  kind: ArbiscanLookupKind;
  value: string | null | undefined;
  className?: string;
}) {
  const href = arbiscanUrl(kind, value);
  if (!href) return null;
  return (
    <Link
      href={href}
      overrideDefaults
      className={cn('inline-flex w-fit items-center gap-1 text-xs text-brand hover:underline', className)}
      data-testid={`arbiscan-${kind}-link`}
    >
      {ARBISCAN_LOOKUP_LABEL[kind]}
      <ExternalLink className="size-3" aria-hidden="true" />
    </Link>
  );
}
