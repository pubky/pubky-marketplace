'use client';

import Link from 'next/link';
import { ACCOUNT_ROUTES, APP_ROUTES, AUTH_ROUTES } from '@/app/routes';
import { Button } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import { PageHeader } from '@/atoms/PageHeader/PageHeader';
import { PageSubtitle } from '@/atoms/PageSubtitle/PageSubtitle';
import { PageTitle } from '@/molecules/Page/Page';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useOnboardingStore } from '@/stores/onboarding/onboarding.store';
import { DialogConfirmBackup } from '../DialogConfirmBackup/DialogConfirmBackup';

export const BackupNavigation = () => {
  const session = useAuthStore((state) => state.session);
  const hasProfile = useAuthStore((state) => state.hasProfile);
  const hasSavedKeys = useOnboardingStore((state) => state.selectHasSecretKey() || state.selectHasMnemonic());
  const href = session
    ? hasProfile === false
      ? ACCOUNT_ROUTES.COMPLETE_PROFILE
      : APP_ROUTES.MARKETPLACE
    : AUTH_ROUTES.SIGN_IN;
  const label = session ? (hasProfile === false ? 'Complete profile' : 'Browse the market') : 'Sign in';

  return (
    <Container className="flex-row flex-wrap justify-end gap-3" id="backup-navigation">
      {hasSavedKeys && <DialogConfirmBackup />}
      <Button asChild variant="secondary">
        <Link href={href}>{label}</Link>
      </Button>
    </Container>
  );
};

export const BackupPageHeader = () => {
  return (
    <PageHeader data-testid="backup-page-header">
      <PageTitle size="large">
        {'Back up saved '}
        <span className="text-brand">{'keys.'}</span>
      </PageTitle>
      <PageSubtitle>
        {
          'These legacy identity keys are saved in this browser. They may belong to a different account than the one signed in.'
        }
      </PageSubtitle>
    </PageHeader>
  );
};
