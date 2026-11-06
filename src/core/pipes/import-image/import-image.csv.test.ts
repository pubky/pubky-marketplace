import { describe, expect, it } from 'vitest';
import { importImageResultCells } from './import-image.csv';

describe('import image result CSV', () => {
  it.each(['=HYPERLINK("x")', '+1', '-1', '@SUM(A1)', '\tcmd'])('neutralises formula prefix in %j', (url) => {
    expect(importImageResultCells({ url, status: 'failed', reason: 'invalid_url' })[0]).toBe(`'${url}`);
  });
});
