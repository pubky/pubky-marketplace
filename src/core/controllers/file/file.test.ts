import { describe, expect, it, vi } from 'vitest';
import { FileApplication } from '@/application/file/file';
import type { Pubky } from '@/models/models.types';
import { FileController } from './file';

describe('FileController.getAvatarUrl', () => {
  it('delegates to FileApplication.getAvatarUrl', () => {
    const pubky = 'o4dksfbqk85ogzdb5osziw6befigbuxmuxkuxq8434q89uj56uyy' as Pubky;
    const url = 'https://cdn.example.com/avatar/test-pubky';
    const avatar = vi.spyOn(FileApplication, 'getAvatarUrl').mockReturnValue(url);

    expect(FileController.getAvatarUrl(pubky)).toBe(url);
    expect(avatar).toHaveBeenCalledWith(pubky, undefined);
  });
});
