'use client';

import { Spinner } from '@/atoms/Spinner/Spinner';
import { OnboardingLayout } from '@/molecules/OnboardingLayout/OnboardingLayout';
import { BackupNavigation, BackupPageHeader } from '@/organisms/Backup/Backup';
import { BackupMethodCard } from '@/organisms/BackupMethodCard/BackupMethodCard';
import { useOnboardingStore } from '@/stores/onboarding/onboarding.store';

export function BackupPage() {
  const hasHydrated = useOnboardingStore((state) => state.hasHydrated);
  return (
    <OnboardingLayout
      testId="backup-content"
      navigation={hasHydrated ? <BackupNavigation /> : undefined}
      pinNavigationToBottom={false}
    >
      <BackupPageHeader />
      {hasHydrated ? <BackupMethodCard /> : <Spinner aria-label="Loading saved keys" />}
    </OnboardingLayout>
  );
}
