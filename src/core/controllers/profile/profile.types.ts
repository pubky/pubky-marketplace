import z from 'zod';
import type { Pubky } from '@/models/models.types';
import type { UiLink } from '@/pipes/user/user.normalizer';
import type { UiUserSchema } from '@/pipes/user/user.validator';

export type TReadProfileParams = {
  userId: Pubky;
};

export type TDeleteAccountInput = {
  pubky: Pubky;
  setProgress?: (progress: number) => void;
};

export type TDownloadDataInput = {
  pubky: Pubky;
  setProgress?: (progress: number) => void;
};

export type TCommitSetDetailsParams = {
  profile: z.infer<typeof UiUserSchema>;
  image: string | null;
  pubky: Pubky;
};

export type TCommitUpdateDetailsParams = {
  name: string;
  bio: string | undefined;
  links: UiLink[] | undefined | null;
  image: string | null;
  pubky: Pubky;
};
