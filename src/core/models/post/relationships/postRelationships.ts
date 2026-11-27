import { Table } from 'dexie';
import { db } from '@/database/franky/franky';
import type { Pubky } from '@/models/models.types';
import type { PostRelationshipsModelSchema } from '@/models/post/relationships/postRelationships.schema';
import { TupleModelBase } from '@/models/shared/base/tuple/baseTuple';
import type { NexusModelTuple } from '@/models/shared/base/tuple/baseTuple.type';
import type { NexusPostRelationships } from '@/services/nexus/nexus.types';

export class PostRelationshipsModel
  extends TupleModelBase<string, PostRelationshipsModelSchema>
  implements PostRelationshipsModelSchema
{
  static table: Table<PostRelationshipsModelSchema> = db.table('post_relationships');

  replied: string | null;
  reposted: string | null;
  mentioned: Pubky[];

  constructor(postRelationships: PostRelationshipsModelSchema) {
    super(postRelationships);
    this.replied = postRelationships.replied;
    this.reposted = postRelationships.reposted;
    this.mentioned = postRelationships.mentioned;
  }

  // Adapter function to convert NexusPostRelationships to PostRelationshipsModelSchema
  static toSchema(data: NexusModelTuple<NexusPostRelationships>): PostRelationshipsModelSchema {
    return { ...data[1], id: data[0] };
  }
}
