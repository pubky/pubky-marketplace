'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, Circle, Key, Loader2, RefreshCw } from 'lucide-react';
import { BasePathImage as Image } from '@/atoms/BasePathImage/BasePathImage';
import { Button } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import { FooterLinks } from '@/atoms/FooterLinks/FooterLinks';
import { PageHeader } from '@/atoms/PageHeader/PageHeader';
import { PageSubtitle } from '@/atoms/PageSubtitle/PageSubtitle';
import { Typography } from '@/atoms/Typography/Typography';
import { isPrivKeysRequested } from '@/config/app';
import { useGrantSignInAvailable } from '@/hooks/useGrantSignInAvailable/useGrantSignInAvailable';
import { useMobileAuth } from '@/hooks/useMobileAuth/useMobileAuth';
import { Logger } from '@/libs/logger/logger';
import { cn } from '@/libs/utils/utils';
import { BalancedQrCard } from '@/molecules/BalancedQrCard/BalancedQrCard';
import { ContentCard } from '@/molecules/Content/Content';
import { IllustratedCard } from '@/molecules/IllustratedCard/IllustratedCard';
import { Logo } from '@/molecules/Logo/Logo';
import { PageTitle } from '@/molecules/Page/Page';
import { PassportSignInButton } from '@/molecules/PassportSignInButton/PassportSignInButton';
import { QrCodeSlot } from '@/molecules/QrCodeSlot/QrCodeSlot';
import {
  SIGN_IN_SIGNER_COPY,
  SIGNER_AUTH_COPY,
  SignerAuthOption,
  SignerAuthorizeButton,
} from '@/molecules/SignerAuthOption/SignerAuthOption';
import { toast } from '@/molecules/Toaster/use-toast';
import { useOnboardingStore } from '@/stores/onboarding/onboarding.store';
import { useSignInStore } from '@/stores/signIn/signIn.store';
import type { SignInState } from '@/stores/signIn/signIn.types';

// Step configuration for the progress display
const SIGN_IN_STEPS = [
  {
    key: 'profileChecked',
    label: 'Setting up',
  },
  {
    key: 'bootstrapFetched',
    label: 'Loading your data',
  },
  {
    key: 'dataPersisted',
    label: 'Building your feed',
  },
  {
    key: 'homeserverSynced',
    label: 'Syncing settings',
  },
] as const;
type StepKey = (typeof SIGN_IN_STEPS)[number]['key'];
type StepStatus = 'completed' | 'running' | 'pending';
const getStepStatus = (stepKey: StepKey, state: SignInState): StepStatus => {
  if (state[stepKey]) return 'completed';

  // Find the first false step (currently running)
  const firstPendingKey = SIGN_IN_STEPS.find((step) => !state[step.key])?.key;
  if (stepKey === firstPendingKey) return 'running';
  return 'pending';
};
const StepIcon = ({ status }: { status: StepStatus }) => {
  switch (status) {
    case 'completed':
      return <CheckCircle className="h-6 w-6 text-brand" />;
    case 'running':
      return <Loader2 className="h-6 w-6 animate-spin text-brand" />;
    case 'pending':
      return <Circle className="h-6 w-6 text-muted-foreground" />;
  }
};
const SignInProgress = () => {
  const state = useSignInStore();
  return (
    <Container className="items-start justify-center">
      <div className="flex w-full max-w-sm flex-col gap-4">
        {SIGN_IN_STEPS.map((step) => {
          const status = getStepStatus(step.key, state);
          return (
            <div key={step.key} className="flex items-center gap-3">
              <StepIcon status={status} />
              <Typography
                as="span"
                className={cn(
                  'text-base leading-normal font-medium',
                  status === 'completed' && 'font-bold text-foreground',
                  status === 'running' && 'text-foreground',
                  status === 'pending' && 'text-muted-foreground',
                )}
              >
                {step.label}
              </Typography>
            </div>
          );
        })}
      </div>
    </Container>
  );
};
async function copyWithToast(copy: () => Promise<void>) {
  try {
    await copy();
    toast({
      variant: 'info',
      title: 'Authentication link copied',
    });
  } catch (error) {
    Logger.error('Failed to copy auth URL to clipboard:', error);
    toast({
      variant: 'error',
      description: 'Could not copy to clipboard',
    });
  }
}

type TSignerAuth = ReturnType<typeof useMobileAuth>;

const SIGNERS = SIGNER_AUTH_COPY.signIn;

/** One QR for Pubky Ring and Bitkit; each mobile button opens its own app. */
const SignInBothSigners = ({
  auth,
  withoutKeys,
  onWithoutKeys,
}: {
  auth: TSignerAuth;
  withoutKeys: boolean;
  onWithoutKeys: () => void;
}) => {
  const offersWithoutKeys = !withoutKeys && isPrivKeysRequested();
  return (
    <Container size="container">
      <SignInHeader signer="both" />
      <div className="grid w-full gap-6 md:grid-cols-2">
        <IllustratedCard
          data-testid="sign-in-qr-card"
          className="rounded-md"
          contentClassName="gap-3"
          visualClassName="lg:hidden xl:flex"
          visual={<Image src="/images/keyring.webp" alt="" width={192} height={192} className="size-48" priority />}
        >
          <div className="flex flex-col gap-3">
            <Typography as="h2" size="lg">
              Sovereign &amp; Secure
            </Typography>
            <Typography className="text-secondary-foreground opacity-80">
              <span className="hidden md:inline">{SIGN_IN_SIGNER_COPY.hint}</span>
              <span className="md:hidden">Authorize with Pubky Ring or Bitkit.</span>
            </Typography>
          </div>
          <div className="flex flex-col items-start gap-4">
            <div className="hidden w-full md:block">
              <SignerAuthOption
                copy={SIGN_IN_SIGNER_COPY}
                auth={auth}
                onCopied={() => copyWithToast(auth.copyAuthUrl)}
                testId="sign-in-qr"
                qrOnly
              />
            </div>
            <div className="flex w-full flex-col gap-3 md:hidden">
              <SignerAuthorizeButton
                copy={SIGNERS.ring}
                auth={{ ...auth, isOpeningRing: auth.openingSigner === 'ring' }}
                testId="button"
                onAuthorize={() => auth.authorizeWith('ring')}
              />
              <SignerAuthorizeButton
                copy={SIGNERS.bitkit}
                auth={{ ...auth, isOpeningRing: auth.openingSigner === 'bitkit' }}
                testId="sign-in-grant-button"
                onAuthorize={() => auth.authorizeWith('bitkit')}
              />
            </div>
            {offersWithoutKeys && (
              <Button
                type="button"
                variant="link"
                className="h-auto border-none p-0 text-left text-sm whitespace-normal shadow-none"
                onClick={onWithoutKeys}
                data-testid="sign-in-without-keys-button"
              >
                Your signer can&apos;t share private-data keys? Sign in without them.
              </Button>
            )}
          </div>
        </IllustratedCard>
        <IllustratedCard
          className="rounded-md"
          visualClassName="lg:hidden xl:flex"
          visual={<Image src="/images/sign-in/cloud.webp" alt="" width={192} height={192} className="size-48" />}
        >
          <div className="flex flex-col gap-3">
            <Typography as="h2" size="lg">
              Quick &amp; Easy
            </Typography>
            <Typography className="text-secondary-foreground opacity-80">Use your existing sign-in methods.</Typography>
          </div>
          <PassportSignInButton />
        </IllustratedCard>
      </div>
    </Container>
  );
};

export const SignInContent = () => {
  const [withoutKeys, setWithoutKeys] = useState(false);
  const auth = useMobileAuth(withoutKeys ? { withPrivKeys: false } : {});
  const { url, isLoading, isExpired, fetchUrl, copyAuthUrl, isOpeningRing, onAuthorizeClick } = auth;
  const authUrlResolved = useSignInStore((state) => state.authUrlResolved);
  const isGrantSignInAvailable = useGrantSignInAvailable();
  useEffect(() => {
    // Clear onboarding storage when sign-in flow begins to prevent backup reminders from showing for existing users
    useOnboardingStore.getState().reset();
  }, []);
  const handleQRClick = async () => {
    if (!url) return;
    await copyWithToast(copyAuthUrl);
  };
  const isMobileLaunching = isLoading || isOpeningRing;
  const mobileAuthorizeContent = isMobileLaunching ? (
    <>
      <Loader2 className="mr-2 size-4 animate-spin" />
      <Typography as="span" overrideDefaults aria-live="polite">
        {isOpeningRing ? 'Opening Pubky Ring...' : 'Generating...'}
      </Typography>
    </>
  ) : isExpired ? (
    <>
      <RefreshCw className="mr-2 size-4" />
      {'Click to reload'}
    </>
  ) : (
    <>
      <Key className="mr-2 size-4" />
      {'Authorize'}
    </>
  );

  const signInQrButton = (
    <button
      type="button"
      className="group relative flex size-48 cursor-pointer items-center justify-center rounded-md bg-foreground p-2 [.light_&]:bg-white"
      onClick={isExpired ? fetchUrl : handleQRClick}
      disabled={isLoading || (!url && !isExpired)}
      aria-label={isExpired ? 'Reload sign-in QR code' : 'Copy authentication link'}
    >
      <QrCodeSlot
        isLoading={isLoading}
        isExpired={isExpired}
        url={url}
        generatingLabel={'Generating QR Code...'}
        clickToReloadLabel={'Click to reload'}
        activeQrHasHoverEffect
      />
    </button>
  );

  // Show progress steps once auth URL is resolved
  if (authUrlResolved) {
    return (
      <Container size="container" className="flex flex-col">
        <SignInProgressHeader />
        <ContentCard layout="column">
          <SignInProgress />
        </ContentCard>
      </Container>
    );
  }
  if (isGrantSignInAvailable) {
    return <SignInBothSigners auth={auth} withoutKeys={withoutKeys} onWithoutKeys={() => setWithoutKeys(true)} />;
  }
  return (
    <>
      <Container size="container" className="hidden md:flex">
        <SignInHeader />
        <BalancedQrCard
          data-testid="sign-in-qr-card"
          illustration={
            <Image
              priority
              src="/images/scan.webp"
              alt="Pubky Ring phone scanning a QR code"
              width={192}
              height={192}
              className="size-48"
            />
          }
        >
          {signInQrButton}
        </BalancedQrCard>
      </Container>

      {/** Mobile view */}
      <Container size="container" className="md:hidden">
        <SignInHeader />
        <ContentCard layout="column">
          <Container className="flex-col items-center justify-center gap-6">
            <Image
              src="/images/logo-pubky-ring.svg"
              alt="Pubky Ring"
              width={137}
              height={30}
              className="[.light_&]:invert"
            />
            <Button
              className="w-full"
              size="lg"
              onClick={onAuthorizeClick}
              disabled={isMobileLaunching || (!url && !isExpired)}
              aria-busy={isMobileLaunching}
              data-testid="button"
            >
              {mobileAuthorizeContent}
            </Button>
          </Container>
        </ContentCard>
      </Container>
    </>
  );
};
export const SignInFooter = () => {
  const authUrlResolved = useSignInStore((state) => state.authUrlResolved);
  if (authUrlResolved) return null;
  return (
    <FooterLinks className="py-6">
      {'Not able to sign in with a keychain? Use the recovery phrase or encrypted file to restore your account.'}
    </FooterLinks>
  );
};
export const SignInHeader = ({ signer = 'ring' }: { signer?: 'ring' | 'both' }) => {
  return (
    <PageHeader>
      <PageTitle size="large">
        {'Sign in to '}
        <span className="text-brand">{'Pubky.'}</span>
      </PageTitle>
      <PageSubtitle>
        {signer === 'both' ? (
          'Choose your preferred sign-in method.'
        ) : (
          <>
            Authorize with <span className="text-brand">Pubky Ring</span> to sign in.
          </>
        )}
      </PageSubtitle>
    </PageHeader>
  );
};
const SignInProgressHeader = () => {
  return (
    <PageHeader>
      <Logo className="py-6 lg:hidden" />
      <PageTitle size="large">{'Signing in.'}</PageTitle>
      <PageSubtitle>{'Please wait while your Pubky experience loads.'}</PageSubtitle>
    </PageHeader>
  );
};
