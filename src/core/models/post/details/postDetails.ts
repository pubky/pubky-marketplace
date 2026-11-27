import { Table } from 'dexie';
import { db } from '@/database/franky/franky';
import type { PostDetailsModelSchema } from '@/models/post/details/postDetails.schema';
import { RecordModelBase } from '@/models/shared/base/record/baseRecord';

export class PostDetailsModel
  extends RecordModelBase<string, PostDetailsModelSchema>
  implements PostDetailsModelSchema
{
  static table: Table<PostDetailsModelSchema> = db.table('post_details');

  content: string;
  indexed_at: number;
  kind: string;
  uri: string;
  attachments: string[] | null;

  constructor(postDetails: PostDetailsModelSchema) {
    super(postDetails);
    this.content = postDetails.content;
    this.indexed_at = postDetails.indexed_at;
    this.kind = postDetails.kind;
    this.uri = postDetails.uri;
    this.attachments = postDetails.attachments;
  }
}
