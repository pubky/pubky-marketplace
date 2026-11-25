import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { Checkbox } from '@/atoms/Checkbox/Checkbox';
import { Link } from '@/atoms/Link/Link';
import { RadioGroup, RadioGroupItem } from '@/atoms/RadioGroup/RadioGroup';
import { Switch } from '@/atoms/Switch/Switch';
import { HotTagCard } from '@/molecules/HotTagCard/HotTagCard';
import { InputField } from '@/molecules/InputField/InputField';
import { TextareaField } from '@/molecules/TextareaField/TextareaField';
import { toast } from '@/molecules/Toaster/toast';
import { Toaster } from '@/molecules/Toaster/Toaster';
import { WordSlot } from '@/molecules/WordSlot/WordSlot';
import { TIMEFRAME } from '@/stores/hot/hot.types';
import { expectGraphicContrast, expectTextContrast } from '@/test-utils/color-contrast';
import { renderForVRT } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP } from '@/test-utils/vrt.viewports';

describe.each(['bg-background', 'bg-card', 'bg-card/80', 'bg-popover'])('Field validation on %s', (surface) => {
  it.each(['dark', 'light'] as const)('keeps values and error messages readable in %s mode', async (theme) => {
    const screen = await renderForVRT(
      <main className="bg-background">
        <section className={surface}>
          <InputField
            id="profile-name"
            variant="dashed"
            value="Invalid"
            status="error"
            message="Enter a valid name."
            readOnly
          />
          <TextareaField
            id="profile-bio"
            variant="dashed"
            value="My bio"
            status="error"
            messageType="error"
            message="Shorten your bio."
            readOnly
          />
        </section>
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP, theme },
    );

    for (const message of ['Enter a valid name.', 'Shorten your bio.']) {
      const hint = screen.getByText(message);
      await expect.element(hint).toBeVisible();
      expectTextContrast(hint.element());
    }
    for (const field of screen.getByRole('textbox').all()) expectTextContrast(field.element());
  });
});

describe('Multiline field focus', () => {
  it.each(['dark', 'light'] as const)(
    'shows keyboard focus and preserves an invalid border in %s mode',
    async (theme) => {
      const screen = await renderForVRT(
        <main className="bg-card">
          <TextareaField value="My bio" variant="dashed" readOnly />
          <TextareaField value="My bio" variant="dashed" status="error" readOnly />
        </main>,
        { viewport: VRT_VIEWPORT_DESKTOP, theme },
      );
      const [bio, invalidBio] = screen.getByRole('textbox').all();
      const bioFrame = bio.element().parentElement!;
      const invalidFrame = invalidBio.element().parentElement!;
      const idleBorder = getComputedStyle(bioFrame).borderTopColor;
      const errorBorder = getComputedStyle(invalidFrame).borderTopColor;
      const idleShadow = getComputedStyle(invalidFrame).boxShadow;

      expect(getComputedStyle(invalidBio.element()).color).toBe(getComputedStyle(bio.element()).color);
      await userEvent.tab();
      await expect.element(bio).toHaveFocus();
      expect(getComputedStyle(bioFrame).borderTopColor).not.toBe(idleBorder);
      await userEvent.tab();
      await expect.element(invalidBio).toHaveFocus();
      expect(getComputedStyle(invalidFrame).borderTopColor).toBe(errorBorder);
      expect(getComputedStyle(invalidFrame).boxShadow).not.toBe(idleShadow);
    },
  );
});

describe.each(['var(--card)', '#000', '#606060', '#fff'])('Success toast over %s', (backdrop) => {
  it.each(['dark', 'light'] as const)('keeps its text and OK button readable in %s mode', async (theme) => {
    const screen = await renderForVRT(
      <main className="fixed inset-0" style={{ backgroundColor: backdrop }}>
        <Toaster />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP, theme },
    );
    const handle = toast({ title: 'Added to cart', description: 'Item saved.', dismissButton: true, persistent: true });
    try {
      const title = screen.getByText('Added to cart', { exact: true });
      const description = screen.getByText('Item saved.', { exact: true });
      const dismiss = screen.getByRole('button', { name: 'OK' });
      await expect.element(dismiss).toBeVisible();
      expectTextContrast(title.element());
      expectTextContrast(description.element());
      await title.hover();
      expectTextContrast(dismiss.element());
      const idleFill = getComputedStyle(dismiss.element()).backgroundColor;
      await dismiss.hover();
      await expect.poll(() => getComputedStyle(dismiss.element()).backgroundColor).not.toBe(idleFill);
      expectTextContrast(dismiss.element());
      await dismiss.click();
      await expect.element(dismiss).not.toBeInTheDocument();
    } finally {
      handle.dismiss();
    }
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
