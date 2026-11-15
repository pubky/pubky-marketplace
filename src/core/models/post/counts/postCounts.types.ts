export interface TPostCountsParams {
  postCompositeId: string;
  countChanges: TPostCountsCountChanges;
  /** Once aborted, the counts are left as they are. */
  signal?: AbortSignal;
}

export interface TPostCountsCountChanges {
  replies?: number;
  reposts?: number;
  tags?: number;
  unique_tags?: number;
}
