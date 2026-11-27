'use client';

import { useState } from 'react';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Typography } from '@/atoms/Typography/Typography';
import { useStoreClaim } from '@/hooks/useStoreClaim/useStoreClaim';
import { STORE_CLAIM_FORM_FIELDS } from '@/hooks/useStoreClaim/useStoreClaim.types';
import { groupPubky } from '@/libs/store-claim/format-pubky';
import { copyToClipboard } from '@/libs/utils/utils';
import { ControlledInputField } from '@/molecules/ControlledInputField/ControlledInputField';
import { StoreSecureContextScreen } from '@/molecules/StoreSecureContextScreen/StoreSecureContextScreen';
import { toast } from '@/molecules/Toaster/toast';
import { AvatarWithFallback } from '@/organisms/AvatarWithFallback/AvatarWithFallback';
import { SignInContent } from '@/organisms/SignIn/SignIn';

export function StoreClaimFlow() {
  const flow = useStoreClaim();
  const [copied, setCopied] = useState(false);

  if (flow.insecureContext) return <StoreSecureContextScreen />;

  const claimDisabled =
    !flow.validCode || flow.busy || flow.retryDisabled || flow.notice?.refusal || flow.notice?.retry === 'mint';

  const copyIdentity = async () => {
    if (!flow.pubky) return;
    try {
      await copyToClipboard({ text: flow.pubky });
      setCopied(true);
      toast({ variant: 'info', description: 'Identity copied.' });
    } catch {
      toast({ variant: 'error', description: 'Could not copy the identity.' });
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10" data-testid="store-claim-flow">
      <div>
        <Typography as="h1" size="lg" className="text-3xl font-bold">
          Claim this shop
        </Typography>
        <Typography as="p" className="mt-2 text-muted-foreground">
          Sign in with the identity that will permanently own this shop.
        </Typography>
      </div>

      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (flow.pubky && !claimDisabled) void flow.submit();
        }}
        noValidate
      >
        <Card className="rounded-md p-0">
          <CardContent className="flex flex-col gap-4 p-6">
            <div className="sentry-block">
              <ControlledInputField
                name={STORE_CLAIM_FORM_FIELDS.CODE}
                control={flow.form.control}
                label="Setup code"
                autoComplete="off"
                variant="default"
                size="md"
                disabled={flow.submitting || flow.claimed}
              />
            </div>
            <div className="text-sm text-muted-foreground">
              <Typography as="p" className="font-medium text-foreground">
                Where to find the code
              </Typography>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Check the deployment&apos;s STORE_CLAIM_TOKEN variable or its setup link.</li>
                <li>For a self-hosted bundle, run ./solo claim-link.</li>
                <li>On Umbrel, use the app password.</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        {flow.notice && (
          <div role="alert" className="rounded-md border border-border bg-muted/40 p-4">
            <Typography as="p">{flow.notice.message}</Typography>
            {flow.notice.capability && (
              <Typography as="p" className="mt-2 text-sm text-muted-foreground">
                Operator hint: grant sessions must be enabled for this Shop client.
              </Typography>
            )}
            {flow.notice.retry && (
              <Button
                type="button"
                className="mt-4"
                variant="secondary"
                disabled={flow.retryDisabled || flow.busy || (flow.notice.retry === 'claim' && !flow.validCode)}
                onClick={() => void (flow.notice?.retry === 'mint' ? flow.retryMint() : flow.submit())}
              >
                Try again
              </Button>
            )}
          </div>
        )}

        {flow.claimed ? (
          <Card className="rounded-md p-0">
            <CardContent className="flex flex-col gap-4 p-6" role="status">
              <Typography as="h2" className="text-xl font-semibold">
                {flow.pollFinished ? 'The shop is claimed. It may take a moment to appear.' : 'The shop is claimed.'}
              </Typography>
              {flow.pollFinished && (
                <Button type="button" onClick={flow.continueToStudio}>
                  Continue
                </Button>
              )}
            </CardContent>
          </Card>
        ) : flow.pubky ? (
          <Card className="rounded-md p-0">
            <CardContent className="flex flex-col gap-5 p-6">
              <div className="flex items-center gap-4">
                <AvatarWithFallback
                  avatarUrl={flow.profileImage ?? undefined}
                  name={flow.profileName ?? flow.pubky}
                  fallbackSeed={flow.pubky}
                  alt="Your profile"
                />
                <div className="min-w-0">
                  {flow.profileName && (
                    <Typography as="p" className="font-semibold">
                      {flow.profileName}
                    </Typography>
                  )}
                  <code className="text-sm break-all" data-testid="grouped-identity">
                    {groupPubky(flow.pubky)}
                  </code>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => void copyIdentity()}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <Typography as="p">
                Claim this shop as {flow.profileName ? <b>{flow.profileName}</b> : <b>{groupPubky(flow.pubky)}</b>}
                {flow.profileName ? ` (${groupPubky(flow.pubky)})` : ''}? Once claimed, this shop permanently serves
                only this identity.
              </Typography>
              <div className="flex flex-wrap gap-3">
                <Button type="submit" disabled={claimDisabled}>
                  {flow.busy ? 'Please wait' : 'Claim this shop'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={flow.busy}
                  onClick={() => void flow.useDifferentIdentity()}
                >
                  Use a different identity
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </form>

      {!flow.claimed && !flow.pubky && (
        <div data-testid="store-claim-sign-in">
          <SignInContent showPassport={false} />
        </div>
      )}
    </main>
  );
}
