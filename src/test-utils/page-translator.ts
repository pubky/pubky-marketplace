/**
 * Simulate what a page translator (Google Translate, Edge, Safari) does to the DOM: every
 * non-blank text node under `root` is replaced by a `<font>` wrapper holding the translation, so
 * the text nodes React owns are detached. Returns the detached originals.
 *
 * The translation is `PT(<original>)`, so a test can tell translated copy from text React wrote
 * after the translation.
 */
export function translateTextNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const originals: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.trim()) originals.push(node as Text);
  }
  for (const original of originals) {
    const font = document.createElement('font');
    font.textContent = `PT(${original.textContent})`;
    original.parentNode?.replaceChild(font, original);
  }
  return originals;
}
