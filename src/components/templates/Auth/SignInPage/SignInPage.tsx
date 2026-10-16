'use client';

import { Button } from '@/atoms/Button/Button';
import { Container } from '@/atoms/Container/Container';
import { Typography } from '@/atoms/Typography/Typography';
import { HOSTED_SIGN_IN_MESSAGE } from '@/libs/auth/sign-in-error-copy';
import { requestShopHostAction } from '@/libs/shop-session/bridge';
import { SignInContent, SignInFooter } from '@/organisms/SignIn/SignIn';
import { SignInNavigation } from '@/organisms/SignInNavigation/SignInNavigation';
import { useIsShopHosted } from '@/providers/ShopHostSessionProvider/ShopHostSessionProvider';

/**
 * Embedded in Pubky App, App owns sign-in. The hand-off waits for a tap: App opens
 * its sign-in with a push, so an automatic request would send Back straight there again.
 */
function HostedSignIn() {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-4 p-6" role="status">
      <Typography as="p">{HOSTED_SIGN_IN_MESSAGE}</Typography>
      <Button onClick={() => requestShopHostAction('request-login')}>Continue in Pubky App</Button>
    </div>
  );
}

export function SignInPage() {
  const hosted = useIsShopHosted();
  if (hosted) return <HostedSignIn />;
  return (
    <Container size="container" className="max-w-screen-xl px-6 lg:px-10">
      <SignInContent />
      <SignInFooter />
      <SignInNavigation />
    </Container>
  );
}
