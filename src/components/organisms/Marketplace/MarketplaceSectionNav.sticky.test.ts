import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const TEMPLATES_DIR = path.resolve(__dirname, '../../templates/Marketplace');
const GLOBALS_CSS = path.resolve(__dirname, '../../../app/globals.css');

const templatesWithSectionNav = readdirSync(TEMPLATES_DIR)
  .filter((file) => file.endsWith('.tsx') && !file.includes('.test.'))
  .map((file) => ({ file, source: readFileSync(path.join(TEMPLATES_DIR, file), 'utf8') }))
  .filter(({ source }) => source.includes('<MarketplaceSectionNav'));

describe('sticky Market section navigation wiring', () => {
  it('finds the pages that render the section navigation', () => {
    expect(templatesWithSectionNav.length).toBeGreaterThanOrEqual(15);
  });

  it.each(templatesWithSectionNav.map(({ file, source }) => [file, source] as const))(
    '%s does not clip the pinned bar inside the main content column',
    (_file, source) => {
      const navAt = source.indexOf('<MarketplaceSectionNav');
      const layoutAt = source.lastIndexOf('<ContentLayout', navAt);
      const layoutTag = source.slice(layoutAt, source.indexOf('>\n', layoutAt));
      // ContentLayout clips its main column at lg+ (overflow-hidden), which turns the column into
      // the scroll container for the sticky bar and stops it pinning to the page.
      expect(layoutTag).toMatch(/disableMainContentOverflow|overflow-visible/);
    },
  );

  it('offsets the bar below the chrome on mobile and desktop, and only by the safe area when embedded', () => {
    const css = readFileSync(GLOBALS_CSS, 'utf8');

    expect(css).toMatch(/--marketplace-subnav-top:\s*var\(--header-offset-mobile\);/);
    expect(css).toMatch(
      /@media \(min-width: 1024px\) \{\s*:root \{\s*--marketplace-subnav-top:\s*var\(--header-offset-main\);\s*\}\s*\}/,
    );
    expect(css).toMatch(
      /html\[data-shop-embedded\] \{[^}]*--marketplace-subnav-top:\s*env\(safe-area-inset-top, 0px\);[^}]*\}/,
    );
    expect(css).not.toContain('.sticky.top-24');
  });
});
