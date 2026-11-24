import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { Button } from '@/atoms/Button/Button';
import { RadioGroup, RadioGroupItem } from '@/atoms/RadioGroup/RadioGroup';
import { expectColorContrast } from '@/test-utils/color-contrast';
import { renderForVRT } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP } from '@/test-utils/vrt.viewports';

const surfaces = ['bg-background', 'bg-card'] as const;

describe.each(surfaces)('Control contrast on %s', (surface) => {
  it.each(['dark', 'light'] as const)('shows the default button keyboard focus ring in %s mode', async (theme) => {
    const screen = await renderForVRT(
      <main className={surface}>
        <input aria-label="Name" />
        {/* Keep the control in the tab order with macOS's default keyboard navigation settings. */}
        <Button tabIndex={0}>Continue</Button>
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP, theme },
    );

    const button = screen.getByRole('button', { name: 'Continue' });
    await screen.getByRole('textbox', { name: 'Name' }).click();
    await userEvent.tab();
    await expect.element(button).toHaveFocus();
    expect(button.element().matches(':focus-visible')).toBe(true);
    const ringSize = '0px 0px 0px 3px';
    const shadows = getComputedStyle(button.element()).boxShadow.split(/,(?![^()]*\))/);
    const ring = shadows.find((shadow) => shadow.includes(ringSize));
    expect(ring).toBeDefined();
    expectColorContrast(ring!.replace(ringSize, '').trim(), screen.getByRole('main').element());
  });

  it('keeps an unchecked radio distinguishable in dark mode', async () => {
    const screen = await renderForVRT(
      <main className={surface}>
        <RadioGroup aria-label="Delivery method">
          <RadioGroupItem value="collect" label="Collect" />
        </RadioGroup>
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP, theme: 'dark' },
    );

    const radio = screen.getByRole('radio', { name: 'Collect' });
    await expect.element(radio).not.toBeChecked();
    const style = getComputedStyle(radio.element());
    expect(parseFloat(style.borderTopWidth)).toBeGreaterThan(0);
    expectColorContrast(style.borderTopColor, radio.element(), screen.getByRole('main').element());
    expectColorContrast(style.borderTopColor, radio.element());
  });
});
