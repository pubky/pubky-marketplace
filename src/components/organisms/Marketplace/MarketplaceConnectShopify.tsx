'use client';

import { ExternalLink, KeyRound, LoaderCircle, Lock, Store } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Heading } from '@/atoms/Heading/Heading';
import { Typography } from '@/atoms/Typography/Typography';
import type { ShopifyGuideScreen } from '@/config/shopify-guide';
import type { useConnectionStatusCheck } from '@/hooks/useConnectionStatusCheck/useConnectionStatusCheck';
import type { UseConnectShopifyResult } from '@/hooks/useConnectShopify/useConnectShopify';
import {
  SHOPIFY_API_VERSION,
  SHOPIFY_DEV_DASHBOARD_URL,
  SHOPIFY_REQUIRED_SCOPES,
  shopifyAdminUrl,
} from '@/libs/commerce/connectors';
import { ControlledInputField } from '@/molecules/ControlledInputField/ControlledInputField';
import { CopyField } from '@/molecules/Marketplace/CopyField';
import { MarketplaceConnectionStatusCheck } from './MarketplaceConnectionStatusCheck';
import { ShopifyGuideFigure } from './ShopifyGuideFigure';

type MarketplaceConnectShopifyProps = {
  shopify: UseConnectShopifyResult;
  statusCheck: ReturnType<typeof useConnectionStatusCheck>;
  onCheck: () => void;
};

type GuideStepProps = {
  number: number;
  title: ReactNode;
  locked?: boolean;
  screen?: ShopifyGuideScreen;
  children: ReactNode;
};

/** One numbered step of the guide, with its picture beside it. */
function GuideStep({ number, title, locked = false, screen, children }: GuideStepProps) {
  return (
    <li
      className="grid gap-4 rounded-md border border-dashed border-border p-4 data-[locked=true]:opacity-60 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]"
      data-testid={`shopify-step-${number}`}
      data-locked={locked}
    >
      <div className="grid content-start gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-background">
            {number}
          </span>
          <Typography as="p" className="pt-0.5 text-sm">
            {title}
          </Typography>
        </div>
        <div className="grid gap-3 text-sm text-muted-foreground md:pl-10">{children}</div>
      </div>
      {screen && <ShopifyGuideFigure screen={screen} />}
    </li>
  );
}

const LOCKED_NOTE = 'Finish step 1 first.';

/**
 * The guided Shopify connection (plan section 10): the seller creates a
 * private app in their own Shopify account and connects it here. The step
 * wording is the approved merchant copy. Pictures are drawn until screenshots
 * of the Dev Dashboard replace them (`config/shopify-guide.ts`).
 */
export function MarketplaceConnectShopify({ shopify, statusCheck, onCheck }: MarketplaceConnectShopifyProps) {
  const { draft, domainForm, keysForm, credentialsSaved, isWorking } = shopify;
  const domain = draft?.domain ?? null;
  const ready = draft !== null;
  const scopes = SHOPIFY_REQUIRED_SCOPES.join(', ');

  return (
    <Card className="rounded-md p-0 shadow-lg" data-surface="store-connect-shopify" data-testid="connect-shopify">
      <CardContent className="grid gap-6 p-6">
        <div className="grid gap-2">
          <div className="flex items-center gap-3">
            <Store className="size-6 shrink-0 text-brand" aria-hidden="true" />
            <Heading level={2} size="md">
              Connect your Shopify store
            </Heading>
          </div>
          <Typography as="p" className="text-sm text-muted-foreground">
            Until our Shopify app is approved, you connect through a private app that you create in your own Shopify
            account. It takes about 10 minutes, and you only do it once. Pubky never sees your Shopify password, and you
            can disconnect at any time.
          </Typography>
        </div>

        <ol className="grid list-none gap-4 p-0">
          <GuideStep
            number={1}
            title={
              <>
                <strong>Enter your store address.</strong> For example <code>your-store.myshopify.com</code>. We&apos;ll
                prepare the links you need below.
              </>
            }
          >
            {ready ? (
              <div className="flex flex-wrap items-center gap-3">
                <Typography as="p" className="text-sm font-semibold text-foreground">
                  {domain}
                </Typography>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="rounded-full"
                  onClick={shopify.startOver}
                >
                  Use a different store
                </Button>
              </div>
            ) : (
              <form
                className="grid gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void shopify.createDraft();
                }}
              >
                <ControlledInputField
                  name="domain"
                  control={domainForm.control}
                  label="Store address"
                  placeholder="your-store.myshopify.com"
                  autoComplete="off"
                />
                <Button type="submit" className="w-fit rounded-full" disabled={isWorking}>
                  {isWorking && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
                  Prepare my links
                </Button>
              </form>
            )}
          </GuideStep>

          <GuideStep
            number={2}
            screen="admin"
            title={
              <>
                <strong>Open the Dev Dashboard.</strong> In Shopify admin, go to{' '}
                <strong>Settings → Apps → Develop apps</strong>, then <strong>Build apps in Dev Dashboard</strong>.
              </>
            }
          >
            {domain ? (
              <Button asChild variant="secondary" size="sm" className="w-fit rounded-full">
                <a href={shopifyAdminUrl(domain)} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4" aria-hidden="true" />
                  Open Shopify admin
                </a>
              </Button>
            ) : (
              <Typography as="p">{LOCKED_NOTE}</Typography>
            )}
          </GuideStep>

          <GuideStep
            number={3}
            screen="create"
            title={
              <>
                <strong>Create the app.</strong> Click <strong>Create app</strong>, choose{' '}
                <strong>Start from Dev Dashboard</strong>, and name it <strong>Pubky Market</strong>.
              </>
            }
          >
            {null}
          </GuideStep>

          <GuideStep
            number={4}
            screen="configure"
            locked={!ready}
            title={
              <>
                <strong>Configure it.</strong> In the app&apos;s new version, set:
              </>
            }
          >
            {draft ? (
              <div className="grid gap-3">
                {draft.urls.launch && (
                  <CopyField label="App URL" value={draft.urls.launch} copiedMessage="App URL copied." />
                )}
                <Typography as="p">
                  <strong className="text-foreground">Embed app in Shopify admin:</strong> off
                </Typography>
                <CopyField
                  label="Allowed redirection URL"
                  value={draft.urls.oauthCallback}
                  copiedMessage="Redirection URL copied."
                />
                <Typography as="p">
                  <strong className="text-foreground">Webhooks API version:</strong> <code>{SHOPIFY_API_VERSION}</code>
                </Typography>
                <CopyField label="Scopes" value={scopes} copyLabel="Copy all" copiedMessage="Scopes copied." />
                <CopyField
                  label="Webhooks URL for privacy requests"
                  value={draft.urls.webhooks}
                  copiedMessage="Webhooks URL copied."
                />
                <Typography as="p" data-testid="shopify-compliance-note">
                  Pubky sets up its other store updates itself after the install. Shopify&apos;s three privacy webhooks
                  (<code>customers/data_request</code>, <code>customers/redact</code>, <code>shop/redact</code>) can
                  only be set in the app, so add them to this URL in the same version.
                </Typography>
                <Typography as="p">
                  Then click <strong className="text-foreground">Release</strong>.
                </Typography>
              </div>
            ) : (
              <Typography as="p">{LOCKED_NOTE}</Typography>
            )}
          </GuideStep>

          <GuideStep
            number={5}
            screen="keys"
            locked={!ready}
            title={
              <>
                <strong>Copy your keys here.</strong> Open the app&apos;s <strong>Settings</strong> and copy the{' '}
                <strong>Client ID</strong> and <strong>Client secret</strong> into these fields. They&apos;re sent
                securely to Pubky and stored encrypted. Pubky never shows them again, and they are never stored with
                your public shop data.
              </>
            }
          >
            <form
              className="grid gap-3"
              data-testid="shopify-keys-form"
              onSubmit={(event) => {
                event.preventDefault();
                void shopify.saveCredentials();
              }}
            >
              <ControlledInputField
                name="clientId"
                control={keysForm.control}
                label="Client ID"
                type="password"
                autoComplete="off"
                disabled={!ready || credentialsSaved}
              />
              <ControlledInputField
                name="clientSecret"
                control={keysForm.control}
                label="Client secret"
                type="password"
                autoComplete="off"
                disabled={!ready || credentialsSaved}
              />
              {credentialsSaved ? (
                <Typography as="p" className="flex items-center gap-2 text-foreground" role="status">
                  <Lock className="size-4 text-brand" aria-hidden="true" />
                  Keys saved and stored encrypted.
                </Typography>
              ) : (
                <Button type="submit" className="w-fit rounded-full" disabled={!ready || isWorking}>
                  {isWorking ? (
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <KeyRound className="size-4" aria-hidden="true" />
                  )}
                  Save
                </Button>
              )}
            </form>
          </GuideStep>

          <GuideStep
            number={6}
            screen="install"
            locked={!credentialsSaved}
            title={
              <>
                <strong>Install on your store.</strong> Click <strong>Install in Shopify</strong> and approve the
                permissions. (If Shopify asks you to install from the Dev Dashboard, open the app&apos;s{' '}
                <strong>Home</strong> → <strong>Install app</strong> instead.)
              </>
            }
          >
            {credentialsSaved ? (
              <Button asChild className="w-fit rounded-full">
                <a href={SHOPIFY_DEV_DASHBOARD_URL} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4" aria-hidden="true" />
                  Install in Shopify
                </a>
              </Button>
            ) : (
              <Button type="button" className="w-fit rounded-full" disabled>
                <ExternalLink className="size-4" aria-hidden="true" />
                Install in Shopify
              </Button>
            )}
            {credentialsSaved && (
              <Typography as="p" data-testid="shopify-install-path">
                Shopify starts the install from your app, so this opens the Dev Dashboard: open{' '}
                <strong className="text-foreground">Pubky Market</strong>, go to{' '}
                <strong className="text-foreground">Home</strong> →{' '}
                <strong className="text-foreground">Install app</strong>, and approve the permissions. Then check the
                connection below.
              </Typography>
            )}
          </GuideStep>

          <GuideStep
            number={7}
            screen="done"
            locked={!credentialsSaved}
            title={
              <>
                <strong>Done.</strong> We check the connection and show your store name, the permissions granted and
                your products ready to import.
              </>
            }
          >
            {draft && credentialsSaved ? (
              <MarketplaceConnectionStatusCheck
                phase={statusCheck.phase}
                result={statusCheck.result}
                onCheck={onCheck}
                storeLabel="Shopify"
              />
            ) : (
              <Typography as="p">Save your keys and install the app first.</Typography>
            )}
          </GuideStep>
        </ol>

        <Typography as="p" className="text-sm text-muted-foreground" data-testid="shopify-why-extra-steps">
          <strong className="text-foreground">Why the extra steps?</strong> Our one-click Shopify app is in
          Shopify&apos;s review. When it&apos;s approved, this button becomes a single click, and your current
          connection keeps working.
        </Typography>
      </CardContent>
    </Card>
  );
}
