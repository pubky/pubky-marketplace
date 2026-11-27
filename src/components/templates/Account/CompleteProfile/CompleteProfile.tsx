'use client';

import { AUTH_ROUTES } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Heading } from '@/atoms/Heading/Heading';
import { Typography } from '@/atoms/Typography/Typography';
import { getSocialHostUrl } from '@/config/social';
import { OnboardingLayout } from '@/molecules/OnboardingLayout/OnboardingLayout';

export function CompleteProfile() {
  return (
    <OnboardingLayout testId="profile-content">
      <section className="flex max-w-lg flex-col items-start gap-4 py-6">
        <Heading level={1} size="xl">
          Complete your Pubky profile
        </Heading>
        <Typography as="p">
          Open Pubky App with the account you use for Market and finish your profile. Then return here to continue.
        </Typography>
        <Button asChild>
          <a href={getSocialHostUrl(AUTH_ROUTES.SIGN_IN)} target="_top">
            Open Pubky App
          </a>
        </Button>
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Check for my profile
        </Button>
      </section>
    </OnboardingLayout>
  );
}
