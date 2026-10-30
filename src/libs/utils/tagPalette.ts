/**
 * Day mode (light theme) chip colours for a tag colour from `generateRandomColor`.
 *
 * The Shop always uses pubky-app's Pastel mapping, its light theme default: the Night mode wash in
 * reverse, 70% white over the tag colour (Figma `alpha/30`), with the foreground label. The selected
 * border and hover glow keep the raw tag colour. pubky-app also offers a Saturated mapping behind a
 * setting; the Shop has no appearance settings, so it does not.
 */

export interface TagDayPalette {
  /** Chip fill */
  background: string;
  /** Label colour */
  label: string;
  /** Count colour, a softer label */
  count: string;
  /** Selected border and hover glow */
  accent: string;
}

type Rgb = [number, number, number];

/** Share of white laid over the tag colour for a pastel chip */
const PASTEL_WHITE_MIX = 0.7;
const CACHE_LIMIT = 2048;

const DARK_LABEL = 'var(--foreground)';
const DARK_COUNT = 'color-mix(in oklab, var(--foreground) 60%, transparent)';

const cache = new Map<string, TagDayPalette>();

function parseHex(color: string): Rgb | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const hex =
    match[1].length === 3
      ? match[1]
          .split('')
          .map((char) => char + char)
          .join('')
      : match[1];
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255) as Rgb;
}

function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((channel) =>
      Math.round(Math.min(1, Math.max(0, channel)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function buildPalette(color: string): TagDayPalette {
  const rgb = parseHex(color);
  if (!rgb) return { background: color, label: DARK_LABEL, count: DARK_COUNT, accent: color };
  return {
    background: toHex(rgb.map((channel) => channel * (1 - PASTEL_WHITE_MIX) + PASTEL_WHITE_MIX) as Rgb),
    label: DARK_LABEL,
    count: DARK_COUNT,
    accent: toHex(rgb),
  };
}

/**
 * Pastel day mode chip colours for a tag colour (`#rrggbb` or `#rgb`). Anything else is returned
 * as the fill with a dark label. Results are memoised per colour.
 */
export function getTagDayPalette(color: string): TagDayPalette {
  const key = color.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const palette = buildPalette(color);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, palette);
  return palette;
}

interface TagPaletteStyleInput {
  /** Night mode fill, as a CSS colour or image depending on the property the component paints */
  nightFill: string;
  /** Night mode border and glow colour */
  nightEdge: string;
  /** Day mode fill, in the same CSS form as `nightFill` */
  dayFill: string;
  day: TagDayPalette;
}

/**
 * Inline custom properties for the `.tag-palette` class in `globals.css`, which resolves
 * `--tag-fill`, `--tag-edge`, `--tag-label` and `--tag-count` for the active theme.
 */
export function getTagPaletteStyle({ nightFill, nightEdge, dayFill, day }: TagPaletteStyleInput): React.CSSProperties {
  return {
    '--tag-night-fill': nightFill,
    '--tag-night-edge': nightEdge,
    '--tag-day-fill': dayFill,
    '--tag-day-edge': day.accent,
    '--tag-day-label': day.label,
    '--tag-day-count': day.count,
  } as React.CSSProperties;
}
