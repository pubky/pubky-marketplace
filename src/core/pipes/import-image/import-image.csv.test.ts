import { describe, expect, it } from 'vitest';
import { importImageResultCells, importImageResultsToCsv } from './import-image.csv';

describe('import image result CSV', () => {
  it('writes url, status and reason with a header', () => {
    const csv = importImageResultsToCsv([
      { url: 'https://cdn.example.com/a.jpg', status: 'uploaded' },
      { url: 'https://cdn.example.com/b.jpg', status: 'failed', reason: 'too_large' },
    ]);
    expect(csv).toBe(
      'image_url,image_status,image_reason\r\nhttps://cdn.example.com/a.jpg,uploaded,\r\nhttps://cdn.example.com/b.jpg,failed,too_large\r\n',
    );
  });

  it('quotes cells containing commas, quotes and newlines', () => {
    const csv = importImageResultsToCsv([{ url: 'https://x.test/a,"b"\n.jpg', status: 'failed', reason: 'not_image' }]);
    expect(csv).toContain('"https://x.test/a,""b""\n.jpg"');
  });

  it.each(['=HYPERLINK("x")', '+1', '-1', '@SUM(A1)', '\tcmd'])('neutralises formula prefix in %j', (url) => {
    expect(importImageResultCells({ url, status: 'failed', reason: 'invalid_url' })[0]).toBe(`'${url}`);
  });
});
