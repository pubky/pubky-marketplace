import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from '@/atoms/Checkbox/Checkbox';
import { Link } from '@/atoms/Link/Link';
import { RadioGroup, RadioGroupItem } from '@/atoms/RadioGroup/RadioGroup';
import { Switch } from '@/atoms/Switch/Switch';
import { HotTagCard } from '@/molecules/HotTagCard/HotTagCard';
import { InputField } from '@/molecules/InputField/InputField';
import { toast } from '@/molecules/Toaster/toast';
import { Toaster } from '@/molecules/Toaster/Toaster';
import { WordSlot } from '@/molecules/WordSlot/WordSlot';
import { TIMEFRAME } from '@/stores/hot/hot.types';
import { expectGraphicContrast, expectTextContrast } from '@/test-utils/color-contrast';
import { renderForVRT } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP } from '@/test-utils/vrt.viewports';

describe('Validation contrast on profile cards', () => {
  it.each(['dark', 'light'] as const)('keeps invalid values and messages readable in %s mode', async (theme) => {
    const screen = await renderForVRT(
      <main className="bg-card p-6">
        <InputField id="profile-name" value="Invalid" status="error" message="Enter a valid name." readOnly />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP, theme },
    );

    const message = screen.getByText('Enter a valid name.');
    await expect.element(message).toBeVisible();
    expectTextContrast(message.element());
    expectTextContrast(screen.getByRole('textbox').element());
  });
});

describe('Success toast contrast', () => {
  it.each(['dark', 'light'] as const)('keeps the dismiss action readable over cards in %s mode', async (theme) => {
    toast({ title: 'Reply posted', dismissButton: true, persistent: true });
    const screen = await renderForVRT(
      <main className="h-full bg-card">
        <Toaster />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP, theme },
    );
    const dismiss = screen.getByRole('button', { name: 'OK' });
    await expect.element(dismiss).toBeVisible();
    expectTextContrast(dismiss.element());
    await dismiss.hover();
    expect(dismiss.element().matches(':hover')).toBe(true);
    expectTextContrast(dismiss.element());
    await dismiss.click();
  });
});

describe('Light theme contrast', () => {
  it('keeps invalid values, recovery words and pastel counts readable', async () => {
    const onClear = vi.fn();
    const screen = await renderForVRT(
      <main className="bg-background p-6">
        <InputField
          id="invalid-bid"
          value="0"
          status="error"
          message="Enter a positive bid."
          messageType="error"
          readOnly
        />
        <WordSlot index={0} word="example" mode="readonly" isCorrect isError={false} onClear={onClear} />
        <WordSlot index={1} word="invalid" mode="readonly" isCorrect={false} isError onClear={onClear} />
        <HotTagCard rank={1} tagName="bitcoin" postCount={371} timeframe={TIMEFRAME.TODAY} />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP, theme: 'light' },
    );

    await screen.getByText('Enter a positive bid.').hover();
    for (const input of document.querySelectorAll('input')) expectTextContrast(input);
    expectTextContrast(screen.getByText('Enter a positive bid.').element());
    expectTextContrast(screen.getByText('371 posts today').element());
    for (const badge of document.querySelectorAll('[data-slot="badge"]')) expectTextContrast(badge);
    for (const index of [1, 2]) {
      const word = screen.getByRole('textbox').nth(index);
      await word.hover();
      expectTextContrast(word.element());
    }
    await screen.getByText('371 posts today').hover();
    expectTextContrast(screen.getByText('371 posts today').element());
    await screen.getByRole('textbox').nth(1).click();
    expect(onClear).toHaveBeenCalledWith(0);
  });

  it('keeps checked control markers distinct from their brand fill', async () => {
    const screen = await renderForVRT(
      <main className="flex gap-6 bg-background p-6">
        <Checkbox defaultChecked aria-label="Accept terms" />
        <RadioGroup defaultValue="selected" aria-label="Delivery method">
          <RadioGroupItem value="selected" aria-label="Collect" />
        </RadioGroup>
        <Switch defaultChecked aria-label="Notifications" />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP, theme: 'light' },
    );

    const checkbox = screen.getByRole('checkbox').element();
    expectGraphicContrast(checkbox.querySelector('svg')!, checkbox);
    const radio = screen.getByRole('radio').element();
    expectGraphicContrast(radio.querySelector('span span')!, radio);
    const toggle = screen.getByRole('switch').element();
    expectGraphicContrast(toggle.querySelector('span')!, toggle);
    await screen.getByRole('checkbox').click();
    await expect.element(screen.getByRole('checkbox')).not.toBeChecked();
    await screen.getByRole('switch').click();
    await expect.element(screen.getByRole('switch')).not.toBeChecked();
  });

  it('keeps brand links readable while hovered on cards and the page', async () => {
    const screen = await renderForVRT(
      <main className="bg-background p-6">
        <div className="bg-card p-4">
          <Link href="/marketplace/sell">Create a listing first</Link>
        </div>
        <Link href="/marketplace/my-shop">Open mission control</Link>
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP, theme: 'light' },
    );
    for (const name of ['Create a listing first', 'Open mission control']) {
      const link = screen.getByRole('link', { name });
      expectTextContrast(link.element());
      await link.hover();
      expectTextContrast(link.element());
    }
  });
});
