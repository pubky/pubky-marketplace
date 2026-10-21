'use client';

import { Trash2 } from 'lucide-react';
import { Button } from '@/atoms/Button/Button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/atoms/Dialog/Dialog';
import { cn } from '@/libs/utils/utils';
import { useOnboardingStore } from '@/stores/onboarding/onboarding.store';

interface DialogSkipBackupProps {
  /** Runs after the recovery phrase and secret key are removed from the browser. */
  onConfirm: () => void;
  triggerClassName?: string;
}

export function DialogSkipBackup({ onConfirm, triggerClassName }: DialogSkipBackupProps) {
  const clearSecrets = useOnboardingStore((state) => state.clearSecrets);

  const handleConfirm = () => {
    clearSecrets();
    onConfirm();
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          id="backup-navigation-skip-btn"
          size="lg"
          variant="secondary"
          className={cn('rounded-full', triggerClassName)}
        >
          Skip backup
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Skip backup?</DialogTitle>
          <DialogDescription>
            Your recovery phrase will be deleted from this browser. Without a backup you can&apos;t restore this account
            after signing out or on another device.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button id="backup-skip-cancel-btn" size="lg" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button id="backup-skip-confirm-btn" size="lg" variant="destructive" onClick={handleConfirm}>
              <Trash2 className="h-4 w-4" />
              Skip and delete phrase
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
