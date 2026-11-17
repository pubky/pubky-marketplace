import { createRef } from 'react';
import type { MDXEditorMethods } from '@mdxeditor/editor';
import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import InitializedMDXEditor from '@/molecules/MarkdownEditor/InitializedMDXEditor';
import { expectTextContrast } from '@/test-utils/color-contrast';
import { renderForVRT } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP } from '@/test-utils/vrt.viewports';

// Link editing does not need the editor's eager CodeMirror language downloads.
vi.mock('@codemirror/language-data', () => ({ languages: [] }));
vi.mock('@/molecules/EmojiPickerDialog/EmojiPickerDialog', () => ({ EmojiPickerDialog: () => null }));

describe('Markdown editor theme contrast', () => {
  it.each(['light', 'dark'] as const)('keeps the link Save control readable in %s mode', async (theme) => {
    const editorRef = createRef<MDXEditorMethods>();
    const onChange = vi.fn();
    const screen = await renderForVRT(
      <main className="bg-card p-6">
        <InitializedMDXEditor editorRef={editorRef} markdown="Edit this text" onChange={onChange} />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP, theme },
    );

    await screen.getByRole('textbox').click();
    await screen.getByRole('button', { name: 'Create link', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').first().fill('https://example.com');
    const save = dialog.getByRole('button', { name: 'Set URL', exact: true });
    await expect.element(save).toBeEnabled();
    expectTextContrast(save.element());
    await save.hover();
    expectTextContrast(save.element());
    await save.click();
    await expect.poll(() => editorRef.current?.getMarkdown()).toContain('https://example.com');
  });
});
