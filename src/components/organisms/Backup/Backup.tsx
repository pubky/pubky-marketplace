'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ONBOARDING_ROUTES } from '@/app/routes';
import { Container } from '@/atoms/Container/Container';
import { PageHeader } from '@/atoms/PageHeader/PageHeader';
import { PageSubtitle } from '@/atoms/PageSubtitle/PageSubtitle';
import { ButtonsNavigation } from '@/molecules/ButtonsNavigation/ButtonsNavigation';
import { PageTitle } from '@/molecules/Page/Page';
import { DialogSkipBackup } from '../DialogSkipBackup/DialogSkipBackup';

export const BackupNavigation = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const goToProfile = () => router.push(ONBOARDING_ROUTES.PROFILE);

  const onHandleContinueButton = () => {
    setLoading(true);
    // Signup already happened at the pubky step; just navigate to profile
    goToProfile();
  };

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
      <DialogSkipBackup triggerClassName="md:self-end" onConfirm={goToProfile} />
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
