'use client';

import { Loader2 } from 'lucide-react';
import { BasePathImage as Image } from '@/atoms/BasePathImage/BasePathImage';
import { Button } from '@/atoms/Button/Button';
import { Typography } from '@/atoms/Typography/Typography';
import { usePassportSignIn } from '@/hooks/usePassportSignIn/usePassportSignIn';

/**
 * "Continue with Google" through Pubky Passport. Renders nothing where the
 * grant key cannot be held (no secure context, IndexedDB or WebCrypto
 * Ed25519) or the deploy turned Passport off. Passport also signs a new
 * Google user up, so sign-up surfaces offer it with an `intro` line.
 */
export function PassportSignInButton({ intro }: { intro?: string } = {}) {
  const passport = usePassportSignIn();
  if (!passport.isAvailable) return null;
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-3" data-testid="sign-in-passport-option">
      {intro && (
        <Typography as="p" className="text-center text-sm text-muted-foreground">
          {intro}
        </Typography>
      )}
      <Button
        className="w-full"
        size="lg"
        variant="secondary"
        onClick={passport.start}
        disabled={passport.isPending}
        aria-busy={passport.isPending}
        data-testid="sign-in-passport-button"
      >
        {passport.isPending ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin motion-reduce:animate-none" />
            <Typography as="span" overrideDefaults aria-live="polite">
              {'Waiting for Pubky Passport...'}
            </Typography>
          </>
        ) : (
          <>
            <Image src="/images/sign-in/google.svg" alt="" width={16} height={16} />
            Continue with Google
          </>
        )}
      </Button>
    </div>
  );
}
