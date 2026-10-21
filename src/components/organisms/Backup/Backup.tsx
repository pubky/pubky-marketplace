'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ONBOARDING_ROUTES } from '@/app/routes';
import { Container } from '@/atoms/Container/Container';
import { PageHeader } from '@/atoms/PageHeader/PageHeader';
import { PageSubtitle } from '@/atoms/PageSubtitle/PageSubtitle';
import { ButtonsNavigation } from '@/molecules/ButtonsNavigation/ButtonsNavigation';
import { PageTitle } from '@/molecules/Page/Page';
import { useOnboardingStore } from '@/stores/onboarding/onboarding.store';
import { DialogSkipBackup } from '../DialogSkipBackup/DialogSkipBackup';

export const BackupNavigation = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const hasHydrated = useOnboardingStore((state) => state.hasHydrated);
  const secretKey = useOnboardingStore((state) => state.secretKey);

  // With the recovery phrase gone (skipped, or dropped after the onboarding lifetime) there is
  // nothing left to back up. Wait for the store to load first: the secrets start out empty in memory.
  useEffect(() => {
    if (hasHydrated && !secretKey) router.replace(ONBOARDING_ROUTES.PROFILE);
  }, [hasHydrated, secretKey, router]);

  const onHandleContinueButton = () => {
    setLoading(true);
    // Signup already happened at the pubky step; just navigate to profile
    router.push(ONBOARDING_ROUTES.PROFILE);
  };

  // Replace the history entry so Back does not return to a backup step whose phrase is deleted.
  const onSkipConfirmed = () => router.replace(ONBOARDING_ROUTES.PROFILE);

  return (
    <Container className="gap-3 pb-6">
      <ButtonsNavigation
        id="backup-navigation"
        className="pb-0"
        loadingContinueButton={loading}
        onHandleContinueButton={onHandleContinueButton}
        continueButtonClassName="w-full md:flex-0"
        backButtonDisabled={true}
      />
      <DialogSkipBackup triggerClassName="md:self-end" onConfirm={onSkipConfirmed} />
    </Container>
  );
};

export const BackupPageHeader = () => {
  return (
    <PageHeader data-testid="backup-page-header">
      <PageTitle size="large">
        {'Back up your '}
        <span className="text-brand">{'pubky.'}</span>
      </PageTitle>
      <PageSubtitle>{'You need a backup to restore access to your account later.'}</PageSubtitle>
    </PageHeader>
  );
};
