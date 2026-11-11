'use client';

import { FileDown, FileText, Scan } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import { Heading } from '@/atoms/Heading/Heading';
import { Typography } from '@/atoms/Typography/Typography';
import { ContentCard } from '@/molecules/Content/Content';
import { PopoverBackup } from '@/molecules/PopoverBackup/PopoverBackup';
import { useOnboardingStore } from '@/stores/onboarding/onboarding.store';
import { DialogBackupEncrypted } from '../DialogBackupEncrypted/DialogBackupEncrypted';
import { DialogBackupExport } from '../DialogBackupExport/DialogBackupExport';
import { DialogBackupPhrase } from '../DialogBackupPhrase/DialogBackupPhrase';

export const BackupMethodCard = () => {
  const mnemonic = useOnboardingStore((state) => state.mnemonic);
  const hasSecretKey = useOnboardingStore((state) => state.selectHasSecretKey());
  const hasMnemonic = useOnboardingStore((state) => state.selectHasMnemonic());

  if (!hasSecretKey && !hasMnemonic) {
    return (
      <ContentCard className="rounded-md">
        <Heading level={2} size="md">
          No saved keys in this browser
        </Heading>
        <Typography>Sign in with your existing account to continue using Pubky Market.</Typography>
      </ContentCard>
    );
  }

  return (
    <ContentCard
      className="rounded-md"
      image={{
        src: '/images/shield.webp',
        alt: 'Shield',
        width: 192,
        height: 192,
      }}
    >
      <Container className="flex-row items-center gap-2">
        <Heading level={2} size="md" className="font-bold">
          {'Choose backup method'}
        </Heading>
        <PopoverBackup />
      </Container>
      <Container className="mx-0 max-w-[576px]">
        <Typography size="sm" className="text-base font-medium text-secondary-foreground opacity-80">
          {'Choose how to back up the legacy identity saved in this browser. Leaving this page keeps your saved keys.'}
        </Typography>
        <Container className="mt-6 flex-col gap-3 lg:flex-row lg:flex-wrap">
          {hasMnemonic && (
            <DialogBackupPhrase>
              <Button id="backup-recovery-phrase-btn" variant="secondary" className="w-full gap-2 font-bold lg:w-auto">
                <FileText className="h-4 w-4" />
                <span>{'Recovery phrase'}</span>
              </Button>
            </DialogBackupPhrase>
          )}
          {hasSecretKey && (
            <DialogBackupEncrypted>
              <Button id="backup-encrypted-file-btn" variant="secondary" className="w-full gap-2 font-bold lg:w-auto">
                <FileDown className="h-4 w-4" />
                <span>{'Encrypted file'}</span>
              </Button>
            </DialogBackupEncrypted>
          )}
          {hasMnemonic && (
            <DialogBackupExport mnemonic={mnemonic}>
              <Button id="backup-pubky-ring-btn" className="w-full gap-2 font-bold lg:w-auto">
                <Scan className="h-4 w-4" />
                <span>{'Export to Pubky Ring'}</span>
              </Button>
            </DialogBackupExport>
          )}
        </Container>
      </Container>
    </ContentCard>
  );
};
