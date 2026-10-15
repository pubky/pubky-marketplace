import { describe, expect, it } from 'vitest';
import { htmlToPlainText } from './import-html-text';

describe('htmlToPlainText', () => {
  it('strips tags, keeps paragraph and line breaks and bullets list items', () => {
    expect(htmlToPlainText('<p>First <b>bold</b></p><p>Second<br/>line</p><ul><li>One</li><li>Two</li></ul>')).toBe(
      'First bold\n\nSecond\nline\n\n• One\n• Two',
    );
  });

  it('decodes entities once and drops scripts and styles', () => {
    expect(htmlToPlainText('Fish &amp; chips &lt;b&gt; &#8364;5 &#x20AC;6 &nbsp;ok')).toBe('Fish & chips <b> €5 €6 ok');
    expect(htmlToPlainText('&amp;lt;')).toBe('&lt;');
    expect(htmlToPlainText('a<script>alert(1)</script>b<style>p{}</style>c')).toBe('a b c');
  });

  it('leaves plain text and unknown entities alone', () => {
    expect(htmlToPlainText('Plain text, no markup')).toBe('Plain text, no markup');
    expect(htmlToPlainText('x &unknown; y')).toBe('x &unknown; y');
    expect(htmlToPlainText('')).toBe('');
  });
});
