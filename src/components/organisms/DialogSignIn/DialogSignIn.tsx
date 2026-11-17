'use client';

/**
 * DialogSignIn
 *
 * A dialog that prompts unauthenticated users to sign in with an existing account.
 * Displayed when users try to perform actions that require authentication
 * (e.g., reply, repost, bookmark, follow, tag).
 *
 * This component reads its open state from authStore.showSignInDialog.
 * It should be rendered once in the app layout, not in individual components.
 *
 * Inspired by pubky-app's Join modal but uses Franky's design patterns.
 */
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { AUTH_ROUTES } from '@/app/routes';
import { BasePathImage as Image } from '@/atoms/BasePathImage/BasePathImage';
import { Button } from '@/atoms/Button/Button';
import { Card } from '@/atoms/Card/Card';
import { Container } from '@/atoms/Container/Container';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/atoms/Dialog/Dialog';
import { Typography } from '@/atoms/Typography/Typography';
import { useIsShopHosted } from '@/providers/ShopHostSessionProvider/ShopHostSessionProvider';
import { useAuthStore } from '@/stores/auth/auth.store';

export function DialogSignIn() {
  const hosted = useIsShopHosted();
  const showSignInDialog = useAuthStore((state) => state.showSignInDialog);
  const setShowSignInDialog = useAuthStore((state) => state.setShowSignInDialog);
  const handleClose = () => setShowSignInDialog(false);
  if (hosted) return null;
  return (
    <Dialog open={showSignInDialog} onOpenChange={setShowSignInDialog}>
      <DialogContent className="w-[576px] gap-6">
        <DialogHeader className="gap-2">
          <DialogTitle>{'Sign in to Pubky'}</DialogTitle>
          <DialogDescription>{'Use your existing account to continue.'}</DialogDescription>
        </DialogHeader>

        <Container className="flex flex-col gap-4 sm:flex-row">
          {/* Sign In Card */}
          <Card className="flex flex-1 flex-col gap-3 rounded-md py-6 sm:gap-6">
            <Container className="gap-2 px-6">
              <Typography as="h3" size="md" className="font-bold">
                {'Already have a pubky?'}
              </Typography>
            </Container>

            <Container className="flex flex-1 items-center justify-center">
              <Image
                src="/images/sign-in.webp"
                alt={'Already have a pubky?'}
                width={202}
                height={202}
                className="h-[87px] w-auto max-w-[202px] sm:h-auto sm:w-full"
              />
            </Container>

            <Container className="px-6">
              <Button asChild variant="secondary" className="w-full gap-2 font-bold text-foreground">
                <Link href={AUTH_ROUTES.SIGN_IN} onClick={handleClose}>
                  <ArrowRight className="size-4" />
                  {'Sign In'}
                </Link>
              </Button>
            </Container>
          </Card>
        </Container>
      </DialogContent>
    </Dialog>
  );
}
