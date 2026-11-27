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
import { expectColorContrast, expectGraphicContrast, expectTextContrast } from '@/test-utils/color-contrast';
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

const focusRingSize = '0px 0px 0px 3px';

function focusRingColor(wrapper: Element) {
  const shadows = getComputedStyle(wrapper).boxShadow.split(/,(?![^()]*\))/);
  const ring = shadows.find((shadow) => shadow.includes(focusRingSize));
  expect(ring).toBeDefined();
  return ring!.replace(focusRingSize, '').trim();
}

for (const [name, Field] of [
  ['Name', InputField],
  ['Bio', TextareaField],
] as const) {
  describe(`${name} keyboard focus`, () => {
    it.each(['dark', 'light'] as const)('shows the default focus border and ring in %s mode', async (theme) => {
      const screen = await renderForVRT(
        <main
          className="bg-card"
          style={{ borderColor: 'var(--ring)', color: 'color-mix(in oklab, var(--ring) 50%, transparent)' }}
        >
          <Field value="My profile" variant="dashed" readOnly />
          <Field value="My profile" variant="dashed" status="error" readOnly />
        </main>,
        { viewport: VRT_VIEWPORT_DESKTOP, theme },
      );
      const [normal, invalid] = screen.getByRole('textbox').all();
      if (Field === TextareaField) {
        expect(getComputedStyle(invalid.element()).color).toBe(getComputedStyle(normal.element()).color);
      }
      const card = screen.getByRole('main').element();
      const wrapper = normal.element().parentElement!;
      expect(getComputedStyle(wrapper).boxShadow).not.toContain(focusRingSize);
      await userEvent.tab();
      await expect.element(normal).toHaveFocus();
      const border = getComputedStyle(wrapper).borderTopColor;
      expect(border).toBe(getComputedStyle(card).borderTopColor);
      expectColorContrast(border, card);
      expect(focusRingColor(wrapper)).toBe(getComputedStyle(card).color);
    });

    describe.each(['bg-background', 'bg-card'])('on %s', (surface) => {
      describe.each(['error', 'success'] as const)('%s state', (status) => {
        it.each(['dark', 'light'] as const)('shows a distinct keyboard focus ring in %s mode', async (theme) => {
          const screen = await renderForVRT(
            <main
              className={`p-4 ${surface}`}
              style={{ borderColor: status === 'error' ? 'var(--destructive)' : 'var(--brand)' }}
            >
              <Field value="My profile" variant="dashed" status={status} readOnly />
            </main>,
            { viewport: VRT_VIEWPORT_DESKTOP, theme },
          );
          const field = screen.getByRole('textbox');
          const wrapper = field.element().parentElement!;
          const backdrop = screen.getByRole('main').element();
          const statusBorder = getComputedStyle(backdrop).borderTopColor;
          expect(getComputedStyle(wrapper).borderTopColor).toBe(statusBorder);
          expect(getComputedStyle(wrapper).boxShadow).not.toContain(focusRingSize);
          await userEvent.tab();
          await expect.element(field).toHaveFocus();
          expect(getComputedStyle(wrapper).borderTopColor).toBe(statusBorder);
          // Light-theme success borders use the brand color, which falls below 3:1 on both surfaces.
          if (status === 'error' || theme === 'dark') expectColorContrast(statusBorder, backdrop);
          expectColorContrast(focusRingColor(wrapper), backdrop);
        });
      });
    });
  });
}

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
      const idle = getComputedStyle(dismiss.element());
      expect(idle.paddingLeft).toBe('14px');
      expect(idle.paddingRight).toBe('14px');
      expect(idle.fontSize).toBe('12px');
      expect(idle.lineHeight).toBe('16px');
      const idleFill = idle.backgroundColor;
      await dismiss.hover();
      await expect.poll(() => getComputedStyle(dismiss.element()).backgroundColor).not.toBe(idleFill);
      expect(getComputedStyle(dismiss.element()).backgroundImage).toMatch(/^linear-gradient/);
      expectTextContrast(dismiss.element());
      await dismiss.click();
      await expect.element(dismiss).not.toBeInTheDocument();
    } finally {
      handle.dismiss();
    }
  });
});

it.each(['dark', 'light'] as const)('shows keyboard focus on OK against the %s success surface', async (theme) => {
  const screen = await renderForVRT(<Toaster />, { viewport: VRT_VIEWPORT_DESKTOP, theme });
  const handle = toast({ title: 'Saved', dismissButton: true, persistent: true });
  try {
    const ok = screen.getByRole('button', { name: 'OK' });
    await expect.element(ok).toBeVisible();
    await screen.getByText('Saved', { exact: true }).click();
    await userEvent.keyboard('{F8}');
    await userEvent.tab();
    await userEvent.tab();
    await expect.element(ok).toHaveFocus();
    const style = getComputedStyle(ok.element());
    expect(style.boxShadow).toContain('0px 0px 0px 3px');
    expectColorContrast(style.getPropertyValue('--tw-ring-color'), ok.element().closest('[data-cy="toast"]')!);
    expectTextContrast(ok.element());
  } finally {
    handle.dismiss();
  }
});

describe.each([
  ['default', 'Undo'],
  ['error', 'Retry'],
] as const)('%s toast action', (variant, label) => {
  it.each(['dark', 'light'] as const)('shows keyboard focus on a neutral button in %s mode', async (theme) => {
    const screen = await renderForVRT(
      <main className="fixed inset-0" style={{ backgroundColor: '#606060' }}>
        <Toaster />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP, theme },
    );
    const handle = toast({
      title: 'Item updated',
      variant,
      persistent: true,
      action: { label, altText: label, onClick: () => {} },
    });
    try {
      const action = screen.getByRole('button', { name: label });
      await expect.element(action).toBeVisible();
      await screen.getByText('Item updated', { exact: true }).click();
      await userEvent.keyboard('{F8}');
      await userEvent.tab();
      await userEvent.tab();
      await expect.element(action).toHaveFocus();
      const style = getComputedStyle(action.element());
      expect(style.outlineStyle).toBe('solid');
      expect(style.outlineWidth).toBe('2px');
      expect(style.outlineOffset).toBe('-2px');
      expectColorContrast(style.outlineColor, action.element());
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
