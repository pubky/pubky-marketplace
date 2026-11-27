import { describe, expect, it } from 'vitest';
import { throwImageUploadSizeLimit } from './imageUploadSizeLimit';

describe('imageUploadSizeLimit', () => {
  it('throws a tagged plain Error for each kind', () => {
    expect(() => throwImageUploadSizeLimit('gif')).toThrow('IMAGE_UPLOAD_SIZE_LIMIT:gif');
  });
});
