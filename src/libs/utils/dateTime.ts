/** Local date and time; bids and exact-time tooltips can retain seconds. */
export function formatDateTime(date: Date, { includeSeconds = false }: { includeSeconds?: boolean } = {}): string {
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: includeSeconds ? 'medium' : 'short',
  });
}
