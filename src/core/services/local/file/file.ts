import { FileDetailsModel } from '@/models/file/fileDetails';
import type { TPersistFilesParams } from '@/services/local/file/file.types';

export class LocalFileService {
  private constructor() {}

  static async createMany({ files }: TPersistFilesParams) {
    await FileDetailsModel.bulkSave(files);
  }
}
