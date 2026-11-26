/**
 * Search bar closed state style (pill shape)
 * - Gradient from theme tokens so light and dark both stay readable
 * - Backdrop blur for glass effect
 */
export const SEARCH_CLOSED_STYLE = {
  background: 'linear-gradient(180deg, var(--search-closed-from) 0%, var(--search-closed-to) 100%)',
  backdropFilter: 'blur(20px)',
} as const;
