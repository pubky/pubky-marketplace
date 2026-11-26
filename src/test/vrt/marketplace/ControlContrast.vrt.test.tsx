import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { Badge } from '@/atoms/Badge/Badge';
import { Button } from '@/atoms/Button/Button';
import { Checkbox } from '@/atoms/Checkbox/Checkbox';
import { RadioGroup, RadioGroupItem } from '@/atoms/RadioGroup/RadioGroup';
import { Switch } from '@/atoms/Switch/Switch';
import { expectColorContrast, expectTextContrast } from '@/test-utils/color-contrast';
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

  it.each(['dark', 'light'] as const)('keeps unchecked controls distinguishable in %s mode', async (theme) => {
    const screen = await renderForVRT(
      <main className={surface}>
        <Checkbox aria-label="Save address" />
        <RadioGroup aria-label="Delivery method">
          <RadioGroupItem value="collect" label="Collect" />
        </RadioGroup>
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP, theme },
    );

    const checkbox = screen.getByRole('checkbox', { name: 'Save address' });
    await expect.element(checkbox).not.toBeChecked();
    expectColorContrast(
      getComputedStyle(checkbox.element()).borderColor,
      checkbox.element(),
      screen.getByRole('main').element(),
    );
    const radio = screen.getByRole('radio', { name: 'Collect' });
    await expect.element(radio).not.toBeChecked();
    const style = getComputedStyle(radio.element());
    expect(parseFloat(style.borderTopWidth)).toBeGreaterThan(0);
    expectColorContrast(style.borderTopColor, radio.element(), screen.getByRole('main').element());
    expectColorContrast(style.borderTopColor, radio.element());
  });
});

it.each(['dark', 'light'] as const)(
  'uses the same readable foreground on solid brand controls in %s mode',
  async (theme) => {
    const screen = await renderForVRT(
      <>
        <Button variant="brand">Continue</Button>
        <Badge>New</Badge>
        <Checkbox aria-label="Accept" checked />
        <Switch aria-label="Enabled" checked />
      </>,
      { viewport: VRT_VIEWPORT_DESKTOP, theme },
    );

    const button = screen.getByRole('button', { name: 'Continue' }).element();
    const badge = screen.getByText('New').element();
    const check = screen.getByRole('checkbox').element().querySelector('svg')!;
    const thumb = screen.getByRole('switch').element().querySelector('span')!;
    const ink = getComputedStyle(button).color;
    expect(getComputedStyle(badge).color).toBe(ink);
    expect(getComputedStyle(check).color).toBe(ink);
    expect(getComputedStyle(thumb).backgroundColor).toBe(ink);
    expectTextContrast(button);
  },
);
