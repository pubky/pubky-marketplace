import { Search } from 'lucide-react';
import { APP_ROUTES } from '@/app/routes';
import { SEARCH_CLOSED_STYLE } from '@/config/search';
import { getSocialHostUrl } from '@/config/social';

export function SearchInput({ autoFocus }: { autoFocus?: boolean } = {}) {
  const socialSearchUrl = getSocialHostUrl(APP_ROUTES.SEARCH);
  return (
    <a
      href={socialSearchUrl}
      target="_top"
      autoFocus={autoFocus}
      aria-label="Search"
      data-cy="header-search"
      className="flex h-12 min-w-0 flex-1 items-center gap-3 rounded-full border border-border px-6 py-3 text-base font-medium text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      style={SEARCH_CLOSED_STYLE}
    >
      <span className="min-w-20 flex-1">Search</span>
      <span className="-mr-2 flex size-8 shrink-0 items-center justify-center" aria-hidden="true">
        <Search className="size-4" />
      </span>
    </a>
  );
}
