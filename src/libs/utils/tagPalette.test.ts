import { describe, expect, it } from 'vitest';
import { getTagDayPalette, getTagPaletteStyle } from './tagPalette';
import { generateRandomColor } from './utils';

const DARK_LABEL = 'var(--foreground)';
const DARK_COUNT = 'color-mix(in oklab, var(--foreground) 60%, transparent)';
/** Light theme `--foreground` */
const DARK_LABEL_HEX = '#303034';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Every colour `generateRandomColor` can produce: six channel patterns times 256 values */
function allGeneratorColours(): string[] {
  const colours = new Set<string>();
  for (let byte = 0; byte < 256; byte++) {
    const x = byte.toString(16).padStart(2, '0');
    [`#ff00${x}`, `#ff${x}00`, `#${x}ff00`, `#${x}00ff`, `#00${x}ff`, `#00ff${x}`].forEach((c) => colours.add(c));
  }
  ['bitcoin', 'synonym', 'bitkit', 'pubky', 'blocktank', 'tether', 'ai'].forEach((name) =>
    colours.add(generateRandomColor(name).toLowerCase()),
  );
  return [...colours];
}

describe('getTagDayPalette', () => {
  it('lays 70% white over the tag colour and keeps the foreground label', () => {
    expect(getTagDayPalette('#FF0000')).toEqual({
      background: '#ffb3b3',
      label: DARK_LABEL,
      count: DARK_COUNT,
      accent: '#ff0000',
    });
    expect(getTagDayPalette('#00FF00').background).toBe('#b3ffb3');
    expect(getTagDayPalette('#0000FF').background).toBe('#b3b3ff');
    expect(getTagDayPalette('#FFFF00').background).toBe('#ffffb3');
  });

  it('keeps every generator colour readable on its day chip', () => {
    for (const colour of allGeneratorColours()) {
      const { background, label } = getTagDayPalette(colour);
      expect(label, colour).toBe(DARK_LABEL);
      expect(contrast(background, DARK_LABEL_HEX), colour).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses the raw tag colour for the selected border and hover glow', () => {
    expect(getTagDayPalette(generateRandomColor('bitcoin')).accent).toBe(generateRandomColor('bitcoin').toLowerCase());
  });

  it('accepts shorthand hex and is case insensitive', () => {
    expect(getTagDayPalette('#f00')).toEqual(getTagDayPalette('#FF0000'));
    expect(getTagDayPalette('#ff0000')).toBe(getTagDayPalette('#FF0000'));
  });

  it('accepts hex without the leading #', () => {
    expect(getTagDayPalette('00ff00').background).toBe('#b3ffb3');
  });

  it('passes through colours it cannot parse', () => {
    expect(getTagDayPalette('rgba(255, 0, 0, 0.3)')).toEqual({
      background: 'rgba(255, 0, 0, 0.3)',
      label: DARK_LABEL,
      count: DARK_COUNT,
      accent: 'rgba(255, 0, 0, 0.3)',
    });
  });
});

describe('getTagPaletteStyle', () => {
  it('maps night and day values onto the custom properties `.tag-palette` reads', () => {
    const day = getTagDayPalette('#FF0000');

    expect(getTagPaletteStyle({ nightFill: 'night-fill', nightEdge: 'night-edge', dayFill: 'day-fill', day })).toEqual({
      '--tag-night-fill': 'night-fill',
      '--tag-night-edge': 'night-edge',
      '--tag-day-fill': 'day-fill',
      '--tag-day-edge': '#ff0000',
      '--tag-day-label': DARK_LABEL,
      '--tag-day-count': DARK_COUNT,
    });
  });
});
