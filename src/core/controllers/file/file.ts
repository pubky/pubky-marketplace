import { FileApplication } from '@/application/file/file';
import type { Pubky } from '@/models/models.types';

export class FileController {
  private constructor() {}

  static getAvatarUrl(pubky: Pubky, version?: string | number): string {
    return FileApplication.getAvatarUrl(pubky, version);
  }
}
