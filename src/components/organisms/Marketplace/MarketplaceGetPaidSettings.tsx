'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  Bitcoin,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  HandCoins,
  LoaderCircle,
  RefreshCw,
  Save,
} from 'lucide-react';
import { Badge } from '@/atoms/Badge/Badge';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/atoms/Collapsible/Collapsible';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/atoms/Dialog/Dialog';
import { Heading } from '@/atoms/Heading/Heading';
import { Input } from '@/atoms/Input/Input';
import { Label } from '@/atoms/Label/Label';
import { Switch } from '@/atoms/Switch/Switch';
import { Typography } from '@/atoms/Typography/Typography';
import { getPaykitServerApi } from '@/config/commerce';
import { CommerceController } from '@/controllers/commerce/commerce';
import { useGrantSigner } from '@/hooks/useGrantSigner/useGrantSigner';
import { useMarketplaceSellerPaymentConfig } from '@/hooks/useMarketplaceSellerPaymentConfig/useMarketplaceSellerPaymentConfig';
import { useUsdtPaymentsCapability } from '@/hooks/useUsdtPaymentsCapability/useUsdtPaymentsCapability';
import { Tether } from '@/icons';
import { isValidPaypalMerchantEmail, type SellerPaymentConfigOwnView } from '@/libs/commerce/payment-methods';
import { deriveUsdtSellerReadiness } from '@/libs/commerce/usdt-seller-setup';
import { truncateMiddle } from '@/libs/utils/utils';
import { BitkitDownloads } from '@/molecules/BitkitDownloads/BitkitDownloads';
import { SettingsSectionContent } from '@/molecules/Settings/SettingsSectionContent/SettingsSectionContent';
import { toast } from '@/molecules/Toaster/use-toast';
import { MarketplaceSessionConnectDialog } from '@/organisms/Marketplace/MarketplaceSessionConnectDialog';
import { MarketplaceUsdtSellerSetup } from '@/organisms/Marketplace/MarketplaceUsdtSellerSetup';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';
import {
  BITCOIN_TOGGLE_BLOCKER_COPY,
  canOfferBitkitSetup,
  deriveBitcoinStatus,
  deriveBitcoinToggleBlocker,
  derivePaypalStatus,
  deriveUsdtStatus,
  PAYMENT_METHOD_STATUS_LABELS,
  type PaymentMethodStatus,
} from './MarketplaceGetPaidSettings.utils';

type MarketplaceGetPaidSettingsProps = {
  onSaved?: (config: SellerPaymentConfigOwnView) => void;
};

type PaykitSetupStatus = 'idle' | 'error' | 'mismatch' | 'unconfirmed' | 'verifying' | 'timeout' | 'usdt-missing';

/** What stays under the Bitkit step after the setup dialog closes without a connection. */
type PaykitSetupProblem = 'mismatch' | 'unconfirmed' | 'error';

/**
 * `setup` opens `/setup` (Bitcoin account, optional USDT address); `reconnect` adds a USDT address to an existing
 * account; `bitcoin-reconnect` re-approves an account Paykit already holds, which upstream `/setup` refuses.
 */
type PaykitSetupMode = 'setup' | 'reconnect' | 'bitcoin-reconnect';

const PAYKIT_SETUP_TIMEOUT_MS = 6 * 60 * 1_000;

/**
 * How a setup attempt ended. paykit-server expires a flow after five minutes and deletes a completed flow with it, so
 * a tab that was suspended while the seller approved in Bitkit polls after expiry and gets an error even though the
 * setup finished. `error` and `timeout` are therefore only claims; the service's own setup status decides.
 */
type PaykitSetupOutcome = 'finished' | 'error' | 'timeout';

function paykitKeyLabel(pubky: string | null): string {
  return pubky ? ` (${truncateMiddle(pubky, 16)})` : '';
}

/** Bitkit approved, but not for the Pubky key this Shop session is signed in with. */
function paykitMismatchMessage(pubky: string | null): string {
  return `Bitkit approved a different pubky than the one you're signed in with here${paykitKeyLabel(pubky)}. In Bitkit, switch to that pubky, then try again.`;
}

/** A setup that finished but that the service's Paykit lookup could not confirm; the seller re-checks, not re-approves. */
const PAYKIT_UNCONFIRMED_COPY = "We couldn't confirm Bitkit's approval just now. Check again in a moment.";

function paykitTimeoutMessage(pubky: string | null): string {
  return `No approval received. If you approved in Bitkit, check that Bitkit holds the pubky you're signed in with here${paykitKeyLabel(pubky)}, then try again.`;
}

/**
 * A seller who has never saved has no payment-config row. The service
 * returns null for that read. Save uses this empty start so the first
 * write can store PayPal or bitcoin. It is not used while the read is in
 * flight or has failed.
 */
const UNSAVED_SELLER_PAYMENT_CONFIG: SellerPaymentConfigOwnView = {
  bitcoinEnabled: false,
  paypalMerchantEmail: null,
  updatedAt: '',
};
const PAYPAL_EMAIL_INVALID_COPY = 'Enter a valid email address.';
const PAYKIT_RECONNECT_EXPLANATION =
  "Scan the code with Bitkit, or open this page on your phone and tap Continue with Bitkit, to share a USDT address. Bitkit also gives Paykit a new Bitcoin account, which can cancel a buyer's pending Bitcoin request that has not been accepted yet.";
const PAYKIT_BITCOIN_RECONNECT_EXPLANATION =
  "Paykit already has a Bitkit setup for this pubky. Approve it again in Bitkit to reconnect. Bitkit gives Paykit a new Bitcoin account, which can cancel a buyer's pending Bitcoin request that has not been accepted yet.";
/** Upstream `/setup` refuses an account Paykit already holds (for example one set up for Locks); reconnect re-approves it. */
const PAYKIT_SETUP_FAILED_COPY =
  'Bitkit setup failed. If this pubky already has a Paykit setup, for example from Locks or another Shop, reconnect it instead.';
const PAYKIT_RECONNECT_FAILED_COPY = 'Reconnecting Bitkit failed. Try again.';

function createPaykitSetupState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function StatusPill({ status, testId }: { status: PaymentMethodStatus; testId: string }) {
  const variant = status === 'connected' ? 'secondary' : status === 'needs_attention' ? 'destructive' : 'outline';
  return (
    <Badge variant={variant} role="status" data-testid={testId} className="shrink-0">
      {PAYMENT_METHOD_STATUS_LABELS[status]}
    </Badge>
  );
}

function MethodCard({
  icon: Icon,
  title,
  promise,
  status,
  statusTestId,
  headerContent,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  promise: string;
  /** Null while the status is still being read: no pill rather than a guess. */
  status: PaymentMethodStatus | null;
  statusTestId: string;
  headerContent?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-md p-0 shadow-lg">
      <CardContent className="grid gap-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-x-3">
            <Icon className="size-6 shrink-0 text-brand" />
            <Heading level={2} size="md">
              {title}
            </Heading>
            <Typography as="p" className="col-start-2 text-sm text-muted-foreground">
              {promise}
            </Typography>
          </div>
          {status && <StatusPill status={status} testId={statusTestId} />}
        </div>
        {headerContent}

        <SettingsSectionContent>{children}</SettingsSectionContent>
      </CardContent>
    </Card>
  );
}

/**
 * The seller's "How you get paid" methods: PayPal, then bitcoin. Card
 * payments are paused, so a stored card configuration is not shown and is
 * written back unchanged when another rail is saved. Bitcoin settles to the
 * seller's own claimed watch-only account. PayPal settles into the seller's
 * own account. This marketplace never receives funds on any rail.
 */
export function MarketplaceGetPaidSettings({ onSaved }: MarketplaceGetPaidSettingsProps) {
  const marketplaceSession = useCommerceStore((state) => state.marketplaceSession);
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const grantSigner = useGrantSigner();
  const payments = useMarketplaceSellerPaymentConfig();
  const refreshPaymentConfig = payments.refresh;
  const commitAccountClaimed = payments.commitAccountClaimed;
  const refreshOwnConfig = payments.refreshOwnConfig;
  const { status: usdtCapability, recheck: recheckUsdtCapability } = useUsdtPaymentsCapability();
  // An unreadable `/health` keeps the card, in its "can't be checked right now"
  // state, instead of hiding USDT from a seller who may have it.
  const showUsdtCard = usdtCapability === 'available' || usdtCapability === 'unreadable';
  const paykitIframeRef = useRef<HTMLIFrameElement>(null);
  const paykitSetupGenerationRef = useRef<string | null>(null);
  const paykitSetupOutcomeRef = useRef<PaykitSetupOutcome>('finished');
  const [paykitSetupOpen, setPaykitSetupOpen] = useState(false);
  const [paykitSetupUrl, setPaykitSetupUrl] = useState<string | null>(null);
  const [paykitSetupState, setPaykitSetupState] = useState<string | null>(null);
  const [paykitSetupCreator, setPaykitSetupCreator] = useState<string | null>(null);
  const [paykitSetupStatus, setPaykitSetupStatus] = useState<PaykitSetupStatus>('idle');
  const [paykitSetupMode, setPaykitSetupMode] = useState<PaykitSetupMode>('setup');
  const [paykitSetupProblemState, setPaykitSetupProblem] = useState<{
    problem: PaykitSetupProblem;
    pubky: string | null;
  } | null>(null);
  const [isRetryingUsdt, setIsRetryingUsdt] = useState(false);
  const [paypalTouched, setPaypalTouched] = useState(false);

  const [railDraft, setRailDraft] = useState<{
    bitcoin: boolean | null;
    paypal: string | null;
    usdt: boolean | null;
  }>({ bitcoin: null, paypal: null, usdt: null });
  const [draftBaseline, setDraftBaseline] = useState<string | null>(null);

  function closePaykitSetup() {
    paykitSetupGenerationRef.current = null;
    setPaykitSetupOpen(false);
    setPaykitSetupUrl(null);
    setPaykitSetupState(null);
    setPaykitSetupCreator(null);
    setPaykitSetupStatus('idle');
    setPaykitSetupMode('setup');
  }

  const serverConfig =
    payments.config ?? (!payments.isLoading && !payments.loadError ? UNSAVED_SELLER_PAYMENT_CONFIG : null);
  const serverBaseline = serverConfig
    ? `${serverConfig.updatedAt}\0${serverConfig.bitcoinEnabled}\0${serverConfig.paypalMerchantEmail ?? ''}\0${serverConfig.usdtEnabled ?? ''}`
    : null;
  if (serverBaseline !== draftBaseline) {
    setDraftBaseline(serverBaseline);
    setRailDraft({ bitcoin: null, paypal: null, usdt: null });
  }

  function showSetupFailure(outcome: 'error' | 'timeout') {
    setPaykitSetupStatus(outcome);
    if (outcome === 'error') setPaykitSetupProblem({ problem: 'error', pubky: currentUserPubky });
  }

  /**
   * Confirms a Bitcoin setup against a fresh read; an unknown answer is re-read, never re-authorized. A callback that
   * reported an error or an expiry is believed only when the service also says the account is not set up.
   */
  function confirmBitcoinSetup(state: string, outcome: PaykitSetupOutcome) {
    paykitSetupOutcomeRef.current = outcome;
    setPaykitSetupStatus('verifying');
    void refreshPaymentConfig().then((claimed) => {
      if (paykitSetupGenerationRef.current !== state) return;
      if (claimed === true) {
        commitAccountClaimed(true);
        setPaykitSetupProblem(null);
        closePaykitSetup();
        toast({ title: paykitSetupMode === 'bitcoin-reconnect' ? 'Bitkit reconnected' : 'Bitkit setup connected' });
        return;
      }
      // `false` is a definite answer. After a finished setup it means Bitkit approved a different key; after an error
      // or an expiry it means the setup really did not complete. `null` is no answer, which must not accuse the seller
      // of a wrong key or of a failed setup.
      if (claimed === false && outcome !== 'finished') {
        showSetupFailure(outcome);
        return;
      }
      const problem = claimed === false ? 'mismatch' : 'unconfirmed';
      setPaykitSetupStatus(problem);
      setPaykitSetupProblem({ problem, pubky: currentUserPubky });
    });
  }

  /** The USDT reconnect succeeded when the service now reports the seller's USDT setup as ready. */
  function confirmUsdtSetup(state: string, outcome: PaykitSetupOutcome) {
    paykitSetupOutcomeRef.current = outcome;
    setPaykitSetupStatus('verifying');
    void refreshOwnConfig().then((next) => {
      if (paykitSetupGenerationRef.current !== state) return;
      if (next && deriveUsdtSellerReadiness(next) === 'ready') {
        closePaykitSetup();
        toast({ title: 'USDT is ready' });
        return;
      }
      if (outcome === 'finished') setPaykitSetupStatus('usdt-missing');
      else showSetupFailure(outcome);
    });
  }

  /**
   * Every end of a setup attempt re-reads the service before any failure is shown. An account that was already
   * connected when the attempt ended proves nothing about this attempt, so an error there is taken as it is.
   */
  function settleSetupAttempt(state: string, outcome: PaykitSetupOutcome) {
    if (paykitSetupMode === 'reconnect') {
      confirmUsdtSetup(state, outcome);
      return;
    }
    if (outcome !== 'finished' && payments.accountClaimed === true) {
      showSetupFailure(outcome);
      return;
    }
    confirmBitcoinSetup(state, outcome);
  }
  const onSetupSettled = useEffectEvent(settleSetupAttempt);

  useEffect(() => {
    if (!paykitSetupOpen || !paykitSetupUrl || !paykitSetupState) return;
    const setupOrigin = new URL(paykitSetupUrl).origin;
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== setupOrigin ||
        event.source !== paykitIframeRef.current?.contentWindow ||
        event.data?.type !== 'paykit-setup-callback' ||
        event.data.state !== paykitSetupState
      ) {
        return;
      }
      if (event.data.error === 'identity-mismatch') {
        setPaykitSetupStatus('mismatch');
        setPaykitSetupProblem({ problem: 'mismatch', pubky: currentUserPubky });
        return;
      }
      onSetupSettled(event.data.state, event.data.error ? 'error' : 'finished');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [currentUserPubky, paykitSetupOpen, paykitSetupState, paykitSetupUrl]);

  useEffect(() => {
    if (!paykitSetupOpen || !paykitSetupUrl || !paykitSetupState || paykitSetupStatus !== 'idle') return;
    const timeout = window.setTimeout(() => onSetupSettled(paykitSetupState, 'timeout'), PAYKIT_SETUP_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [paykitSetupOpen, paykitSetupState, paykitSetupStatus, paykitSetupUrl]);

  useEffect(() => {
    if (paykitSetupOpen && (!marketplaceSession || !currentUserPubky || currentUserPubky !== paykitSetupCreator)) {
      closePaykitSetup();
    }
  }, [currentUserPubky, marketplaceSession, paykitSetupCreator, paykitSetupOpen]);

  const openPaykitSetup = (mode: PaykitSetupMode) => {
    if (!marketplaceSession || !currentUserPubky) return;
    const state = createPaykitSetupState();
    const url =
      mode === 'setup'
        ? CommerceController.getPaykitSetupUrl(window.location.href, state, currentUserPubky)
        : CommerceController.getPaykitReconnectUrl(window.location.href, state, currentUserPubky);
    paykitSetupGenerationRef.current = state;
    setPaykitSetupMode(mode);
    setPaykitSetupState(state);
    setPaykitSetupUrl(url);
    setPaykitSetupCreator(currentUserPubky);
    setPaykitSetupStatus('idle');
    setPaykitSetupProblem(null);
    setPaykitSetupOpen(true);
  };

  const onSave = async () => {
    if (!serverConfig || payments.isLoading || serverBaseline !== draftBaseline) return;
    const saved = await payments.save({
      bitcoinEnabled: railDraft.bitcoin ?? serverConfig.bitcoinEnabled,
      paypalMerchantEmail: railDraft.paypal ?? serverConfig.paypalMerchantEmail ?? '',
      // The service accepts the field only while its USDT flag is on, and it
      // reports `usdt_enabled` on the own config exactly then. Sending it on
      // any other signal would make a service without it refuse the whole save,
      // PayPal and Bitcoin included. Sending the stored value keeps those saves
      // from resetting the consent.
      ...(serverConfig.usdtEnabled !== undefined ? { usdtEnabled: railDraft.usdt ?? serverConfig.usdtEnabled } : {}),
    });
    if (saved) onSaved?.(saved);
  };

  const paypalValue = railDraft.paypal ?? serverConfig?.paypalMerchantEmail ?? '';
  const paypalInvalid = !isValidPaypalMerchantEmail(paypalValue);
  const showPaypalError = paypalInvalid && paypalTouched;
  const saveReady =
    Boolean(serverConfig) &&
    !payments.isLoading &&
    !payments.loadError &&
    serverBaseline === draftBaseline &&
    !paypalInvalid;

  const saveButton = (
    <Button className="w-fit rounded-full" disabled={payments.isSaving || !saveReady} onClick={() => void onSave()}>
      {payments.isSaving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
      Save changes
    </Button>
  );

  const paypalStatus = derivePaypalStatus(payments.config);
  const usdtReadiness = deriveUsdtSellerReadiness(serverConfig ?? {});
  const upstreamPaykit = getPaykitServerApi() === 'upstream';
  // Upstream Paykit refuses a second initial setup for an account it holds. A connected wallet reconnects, and so
  // does a seller the service says Paykit holds (`bitcoin_setup_action`): their reconnect stopped after Paykit
  // stored the credentials, so every rail reads as not set up until it completes.
  const bitcoinNeedsReconnect =
    upstreamPaykit && payments.accountClaimed === false && payments.config?.bitcoinSetupAction === 'reconnect';
  // Before a session there is no read: the pill matches PayPal and USDT and the
  // Enable selling card is the next step. A reload keeps a known answer; with
  // none yet, nothing is claimed until the read returns.
  const bitkitRead: 'no-session' | 'checking' | 'known' | 'unknown' = canOfferBitkitSetup(payments.accountClaimed)
    ? 'known'
    : !marketplaceSession
      ? 'no-session'
      : payments.isLoading
        ? 'checking'
        : 'unknown';
  const bitcoinStatus: PaymentMethodStatus | null =
    bitkitRead === 'no-session'
      ? 'not_set_up'
      : bitkitRead === 'checking'
        ? null
        : deriveBitcoinStatus(payments.accountClaimed, bitcoinNeedsReconnect);
  // Until the first read returns there is no readiness to show; deriving it
  // from no config would fail closed to `unavailable` and flash Needs attention.
  const usdtStatus: PaymentMethodStatus | null =
    payments.isLoading && !payments.config ? null : deriveUsdtStatus(usdtReadiness);
  const usdtValue = railDraft.usdt ?? serverConfig?.usdtEnabled ?? false;
  const serverBitcoin = serverConfig?.bitcoinEnabled ?? false;
  const bitcoinValue = railDraft.bitcoin ?? serverBitcoin;
  const paykitSetupProblem =
    paykitSetupProblemState && paykitSetupProblemState.pubky === currentUserPubky
      ? paykitSetupProblemState.problem
      : null;
  const paykitCodeExpired = paykitSetupStatus === 'error' || paykitSetupStatus === 'timeout';
  const step2Mode: PaykitSetupMode =
    upstreamPaykit && (payments.accountClaimed === true || bitcoinNeedsReconnect) ? 'bitcoin-reconnect' : 'setup';
  const offerBitcoinReconnect =
    upstreamPaykit && step2Mode === 'setup' && paykitSetupProblem === 'error' && payments.accountClaimed === false;
  const failedSetupInDialog = upstreamPaykit && paykitSetupStatus === 'error' && paykitSetupMode === 'setup';
  // The service's `reconnect` is its record that Paykit once held the seller. A Paykit that no longer holds the creator
  // refuses `/setup/reconnect` before serving its page, so nothing calls back and the reconnect only expires; an expired
  // one falls back to initial setup. An `error` callback means Paykit found the creator, so it keeps the reconnect.
  const paykitHoldsSellerPerService =
    upstreamPaykit &&
    payments.accountClaimed === false &&
    (payments.config?.bitcoinSetupAction === 'reconnect' || payments.config?.usdtSetupAction === 'reconnect');
  const expiredServiceReconnectInDialog =
    paykitHoldsSellerPerService && paykitSetupMode !== 'setup' && paykitSetupStatus === 'timeout';
  // Only the missing-step reason is explained here; without a session the
  // card's "Enable selling" prompt already says why the switch is off.
  const bitcoinToggleBlocker =
    marketplaceSession && !payments.isLoading && !payments.loadError && !bitcoinValue && bitcoinStatus !== 'connected'
      ? deriveBitcoinToggleBlocker(payments.accountClaimed, bitcoinNeedsReconnect)
      : null;

  // Stored rails need the marketplace session and the loaded config; the
  // bitcoin connect steps above them render outside this gate.
  const renderStoredRailBody = (children: React.ReactNode) => {
    if (!marketplaceSession) {
      return (
        <Typography as="p" className="text-sm text-muted-foreground">
          Enable selling above to set this up.
        </Typography>
      );
    }
    if (payments.isLoading) {
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Loading payment settings…
        </div>
      );
    }
    if (payments.loadError) {
      return (
        <Typography as="p" role="alert" className="text-sm text-amber-300">
          {payments.loadError}
        </Typography>
      );
    }
    return children;
  };

  return (
    <section aria-label="Payment methods" className="flex flex-col gap-6" data-surface="marketplace-get-paid">
      {!marketplaceSession && (
        <Card className="rounded-md p-0 shadow-lg" data-testid="enable-selling-card">
          <CardContent className="grid gap-6 p-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="grid gap-1">
              <Heading level={2} size="md">
                Enable selling
              </Heading>
              <Typography as="p" className="text-sm text-muted-foreground">
                Enable selling to save your payment methods.
              </Typography>
              <Typography as="p" className="text-sm text-muted-foreground">
                You approve once, with the same app you signed in with.
              </Typography>
            </div>
            <MarketplaceSessionConnectDialog triggerLabel="Enable selling" intent="sell" />
          </CardContent>
        </Card>
      )}

      <MethodCard
        icon={HandCoins}
        title="PayPal"
        promise="Get paid directly to your PayPal account."
        status={paypalStatus}
        statusTestId="payment-method-status-paypal"
      >
        {renderStoredRailBody(
          <>
            <div className="grid gap-3">
              <div>
                <Label htmlFor="get-paid-paypal" className="font-medium">
                  PayPal email
                </Label>
              </div>
              <Input
                theme="dashed"
                id="get-paid-paypal"
                type="email"
                value={paypalValue}
                onChange={(event) => setRailDraft((draft) => ({ ...draft, paypal: event.target.value }))}
                placeholder="you@example.com"
                autoComplete="off"
                className="max-w-md"
                aria-label="PayPal merchant email"
                onBlur={() => setPaypalTouched(true)}
                aria-invalid={showPaypalError || undefined}
                aria-describedby={showPaypalError ? 'get-paid-paypal-error' : undefined}
              />
              {showPaypalError && (
                <Typography as="p" id="get-paid-paypal-error" role="alert" className="text-sm text-amber-300">
                  {PAYPAL_EMAIL_INVALID_COPY}
                </Typography>
              )}
            </div>
            {saveButton}
          </>,
        )}
      </MethodCard>

      <MethodCard
        icon={Bitcoin}
        title="Bitcoin"
        promise="Connect your Bitkit wallet to accept bitcoin."
        status={bitcoinStatus}
        statusTestId="payment-method-status-bitcoin"
        headerContent={getPaykitServerApi() === 'upstream' ? <BitkitDownloads compact /> : undefined}
      >
        <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div>
            <Typography as="h3" className="text-sm font-semibold">
              {bitkitRead === 'checking' || bitkitRead === 'unknown' ? '1. Bitkit wallet' : '1. Connect Bitkit'}
            </Typography>
            {bitkitRead === 'checking' ? (
              <Typography
                as="p"
                className="flex items-center gap-2 text-sm text-muted-foreground"
                data-testid="bitkit-setup-checking"
              >
                <LoaderCircle className="size-4 animate-spin" />
                Checking Bitkit…
              </Typography>
            ) : bitkitRead === 'unknown' ? (
              <Typography
                as="p"
                id="get-paid-bitkit-unknown"
                role="status"
                className="text-sm text-amber-300"
                data-testid="bitkit-setup-unknown"
              >
                {BITCOIN_TOGGLE_BLOCKER_COPY['bitkit-unknown']}
              </Typography>
            ) : (
              <Typography as="p" className="text-sm text-muted-foreground">
                Approve payment setup in Bitkit to receive bitcoin.
              </Typography>
            )}
            {payments.accountClaimed === true && (
              <Typography as="p" className="mt-2 flex items-center gap-2 text-sm text-brand">
                <CheckCircle2 className="size-4" />
                Wallet connected.
              </Typography>
            )}
            {payments.accountClaimed !== true && !paykitSetupOpen && paykitSetupProblem && (
              <Typography
                as="p"
                role="alert"
                className="mt-2 text-sm text-amber-300"
                data-testid="paykit-setup-problem"
              >
                {paykitSetupProblem === 'mismatch'
                  ? paykitMismatchMessage(currentUserPubky)
                  : paykitSetupProblem === 'unconfirmed'
                    ? PAYKIT_UNCONFIRMED_COPY
                    : offerBitcoinReconnect
                      ? PAYKIT_SETUP_FAILED_COPY
                      : step2Mode === 'bitcoin-reconnect'
                        ? PAYKIT_RECONNECT_FAILED_COPY
                        : 'Bitkit setup failed. Try again.'}
              </Typography>
            )}
          </div>
          {bitkitRead === 'unknown' ? (
            <Button variant="secondary" className="w-fit" onClick={() => void refreshPaymentConfig()}>
              <RefreshCw className="size-4" />
              Check again
            </Button>
          ) : bitkitRead === 'checking' ? null : (
            <div className="flex flex-wrap gap-2">
              {offerBitcoinReconnect && (
                <Button
                  variant="secondary"
                  className="w-fit"
                  disabled={!marketplaceSession || !currentUserPubky}
                  onClick={() => openPaykitSetup('bitcoin-reconnect')}
                >
                  Reconnect Bitkit
                  <ExternalLink className="size-4" />
                </Button>
              )}
              <Button
                variant="secondary"
                className="w-fit"
                disabled={!marketplaceSession || !currentUserPubky}
                onClick={() => openPaykitSetup(step2Mode)}
              >
                {step2Mode === 'bitcoin-reconnect'
                  ? 'Reconnect Bitkit'
                  : paykitSetupProblem && payments.accountClaimed !== true
                    ? 'Try again'
                    : 'Connect Bitkit'}
                <ExternalLink className="size-4" />
              </Button>
            </div>
          )}
        </div>

        <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div>
            <Typography as="label" htmlFor="get-paid-bitcoin" className="block text-sm font-semibold">
              2. Accept bitcoin
            </Typography>
            <Typography as="p" className="text-sm text-muted-foreground">
              Offer bitcoin payment option at checkout.
            </Typography>
            {(bitcoinToggleBlocker === 'bitkit' || bitcoinToggleBlocker === 'bitkit-reconnect') && (
              <Typography
                as="p"
                id="get-paid-bitcoin-blocker"
                className="mt-2 text-sm text-muted-foreground"
                data-testid="bitcoin-toggle-blocker"
              >
                {BITCOIN_TOGGLE_BLOCKER_COPY[bitcoinToggleBlocker]}{' '}
                <Button
                  variant="link"
                  className="h-auto p-0"
                  disabled={!currentUserPubky}
                  onClick={() => openPaykitSetup(step2Mode)}
                >
                  {step2Mode === 'bitcoin-reconnect' ? 'Reconnect now' : 'Connect now'}
                </Button>
              </Typography>
            )}
          </div>
          <Switch
            id="get-paid-bitcoin"
            aria-describedby={
              bitcoinToggleBlocker === 'bitkit' || bitcoinToggleBlocker === 'bitkit-reconnect'
                ? 'get-paid-bitcoin-blocker'
                : bitkitRead === 'unknown' && !bitcoinValue
                  ? 'get-paid-bitkit-unknown'
                  : undefined
            }
            checked={bitcoinValue}
            onCheckedChange={(enabled) => {
              if (enabled && bitcoinStatus !== 'connected') return;
              setRailDraft((draft) => ({ ...draft, bitcoin: enabled }));
            }}
            disabled={
              !marketplaceSession ||
              payments.isLoading ||
              Boolean(payments.loadError) ||
              (!bitcoinValue && bitcoinStatus !== 'connected')
            }
            aria-label="Accept bitcoin"
          />
        </div>

        {renderStoredRailBody(
          <>
            <Collapsible>
              <CollapsibleTrigger className="group flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
                <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
                Technical details
              </CollapsibleTrigger>
              <CollapsibleContent className="grid gap-3 pt-4 text-sm text-muted-foreground data-[state=closed]:hidden">
                <Typography as="p" className="text-sm text-muted-foreground">
                  Bitkit keeps your spending keys private and shares a watch-only account with Paykit to generate
                  payment addresses. Payments go directly to your wallet through private payment requests, without
                  exposing your identity secret to Shop.
                  {payments.accountClaimed !== true &&
                    (payments.accountClaimed === null
                      ? ' Your wallet status is currently unavailable.'
                      : ' Connect Bitkit to finish wallet setup.')}
                </Typography>
              </CollapsibleContent>
            </Collapsible>

            {saveButton}
          </>,
        )}
      </MethodCard>

      {showUsdtCard && (
        <MethodCard
          icon={Tether}
          title="USDT"
          promise="Get paid in USDT, directly to your Bitkit wallet."
          status={usdtStatus}
          statusTestId="payment-method-status-usdt"
        >
          {renderStoredRailBody(
            <>
              <MarketplaceUsdtSellerSetup
                readiness={usdtReadiness}
                enabled={usdtValue}
                onEnabledChange={(enabled) => {
                  if (enabled && usdtReadiness !== 'ready') return;
                  setRailDraft((draft) => ({ ...draft, usdt: enabled }));
                }}
                onSetup={() => openPaykitSetup('setup')}
                onReconnect={() => openPaykitSetup('reconnect')}
                onRetry={() => {
                  setIsRetryingUsdt(true);
                  void Promise.all([refreshOwnConfig(), recheckUsdtCapability()]).finally(() =>
                    setIsRetryingUsdt(false),
                  );
                }}
                isRetrying={isRetryingUsdt}
                canOpenBitkit={Boolean(marketplaceSession && currentUserPubky)}
                signer={grantSigner}
              />
              {saveButton}
            </>,
          )}
        </MethodCard>
      )}

      <Dialog open={paykitSetupOpen} onOpenChange={(open) => (open ? setPaykitSetupOpen(true) : closePaykitSetup())}>
        <DialogContent className="w-full max-w-lg" centered>
          <DialogHeader>
            <DialogTitle>
              {paykitSetupMode === 'reconnect'
                ? 'Add USDT in Bitkit'
                : paykitSetupMode === 'bitcoin-reconnect'
                  ? 'Reconnect Bitkit'
                  : 'Connect Bitkit'}
            </DialogTitle>
          </DialogHeader>
          {paykitSetupStatus !== 'idle' && (
            <div role="alert" className="grid gap-3 rounded-md border border-amber-500/40 p-3 text-sm">
              <Typography as="p">
                {paykitSetupStatus === 'error'
                  ? failedSetupInDialog
                    ? PAYKIT_SETUP_FAILED_COPY
                    : paykitSetupMode === 'bitcoin-reconnect'
                      ? PAYKIT_RECONNECT_FAILED_COPY
                      : 'Bitkit setup failed. Try again.'
                  : paykitSetupStatus === 'mismatch'
                    ? paykitMismatchMessage(currentUserPubky)
                    : paykitSetupStatus === 'unconfirmed'
                      ? PAYKIT_UNCONFIRMED_COPY
                      : paykitSetupStatus === 'verifying'
                        ? paykitSetupMode === 'reconnect'
                          ? 'Confirming your USDT address…'
                          : 'Confirming your pubky…'
                        : paykitSetupStatus === 'usdt-missing'
                          ? 'Bitkit did not confirm a USDT address. Try again.'
                          : paykitTimeoutMessage(currentUserPubky)}
              </Typography>
              {expiredServiceReconnectInDialog && (
                <Typography as="p">If Bitkit never showed a request, Connect Bitkit starts the setup again.</Typography>
              )}
              <div className="flex flex-wrap gap-2">
                {failedSetupInDialog && (
                  <Button
                    variant="secondary"
                    className="w-fit rounded-full"
                    onClick={() => openPaykitSetup('bitcoin-reconnect')}
                  >
                    <RefreshCw className="size-4" />
                    Reconnect Bitkit
                  </Button>
                )}
                {expiredServiceReconnectInDialog && (
                  <Button variant="secondary" className="w-fit rounded-full" onClick={() => openPaykitSetup('setup')}>
                    <RefreshCw className="size-4" />
                    Connect Bitkit
                  </Button>
                )}
                {paykitSetupStatus === 'unconfirmed' ? (
                  <Button
                    variant="secondary"
                    className="w-fit rounded-full"
                    onClick={() => {
                      if (paykitSetupGenerationRef.current) {
                        confirmBitcoinSetup(paykitSetupGenerationRef.current, paykitSetupOutcomeRef.current);
                      }
                    }}
                  >
                    <RefreshCw className="size-4" />
                    Check again
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    className="w-fit rounded-full"
                    onClick={() => openPaykitSetup(paykitSetupMode)}
                  >
                    <RefreshCw className="size-4" />
                    Retry
                  </Button>
                )}
              </div>
            </div>
          )}
          <Typography as="p" className="text-sm text-muted-foreground">
            {paykitSetupMode === 'reconnect' ? (
              PAYKIT_RECONNECT_EXPLANATION
            ) : paykitSetupMode === 'bitcoin-reconnect' ? (
              PAYKIT_BITCOIN_RECONNECT_EXPLANATION
            ) : (
              <>
                <span className="[@media(hover:none)_and_(pointer:coarse)]:hidden">Scan the code with Bitkit</span>
                <span className="hidden [@media(hover:none)_and_(pointer:coarse)]:inline">
                  Tap Continue with Bitkit
                </span>
              </>
            )}
          </Typography>
          {paykitSetupUrl && paykitCodeExpired ? (
            <div
              data-testid="paykit-setup-qr-expired"
              className="flex h-40 w-full items-center justify-center rounded-md bg-muted/40 p-6 text-center text-sm text-muted-foreground"
            >
              This code expired.
            </div>
          ) : (
            paykitSetupUrl && (
              <iframe
                ref={paykitIframeRef}
                key={paykitSetupUrl}
                src={`${paykitSetupUrl}#embed`}
                title={
                  paykitSetupMode === 'reconnect'
                    ? 'Add USDT in Bitkit'
                    : paykitSetupMode === 'bitcoin-reconnect'
                      ? 'Reconnect Bitkit'
                      : 'Connect Bitkit'
                }
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation-to-custom-protocols"
                referrerPolicy="no-referrer"
                className={
                  // Upstream Paykit's page is only its 192px QR panel (a 60px Bitkit button on touch screens).
                  upstreamPaykit
                    ? 'h-48 w-full [@media(hover:none)_and_(pointer:coarse)]:h-15'
                    : 'h-[40rem] w-full rounded-lg border bg-popover'
                }
              />
            )
          )}
          <DialogFooter>
            <Button variant="secondary" className="rounded-full" onClick={closePaykitSetup}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
