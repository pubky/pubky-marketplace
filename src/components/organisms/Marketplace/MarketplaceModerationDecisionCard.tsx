import { ShieldAlert } from 'lucide-react';
import { getMarketplaceListingRoute, getMarketplaceShopRoute } from '@/app/routes';
import { Card, CardContent } from '@/atoms/Card/Card';
import { Link } from '@/atoms/Link/Link';
import { Typography } from '@/atoms/Typography/Typography';
import { MODERATION_DECISION_COPY } from '@/config/commerce-copy';
import { COMPLAINT_EMAIL } from '@/config/legal';
import { parseListingUri } from '@/libs/commerce/listingUri';
import { commercePubkySchema } from '@/libs/commerce/transaction-contracts';
import { formatDateTime } from '@/libs/utils/dateTime';
import type { MarketplaceModerationDecision } from '@/services/marketplace/marketplace-projections';

const PROFILE_URI_PATTERN = /^pubky:\/\/([^/]+)\/pub\/pubky\.app\/profile\.json$/;

/** Where the restricted item can be opened in the Shop, or null for a review or a malformed target. */
export function moderationTargetLink(
  decision: Pick<MarketplaceModerationDecision, 'restriction' | 'targetUri'>,
): { href: string; label: string } | null {
  if (decision.restriction === 'listing_removed') {
    const listing = parseListingUri(decision.targetUri);
    return listing
      ? {
          href: getMarketplaceListingRoute(listing.sellerPubky, listing.listingId),
          label: MODERATION_DECISION_COPY.viewListing,
        }
      : null;
  }
  if (decision.restriction === 'shop_suspended') {
    const owner = PROFILE_URI_PATTERN.exec(decision.targetUri)?.[1];
    return owner && commercePubkySchema.safeParse(owner).success
      ? { href: getMarketplaceShopRoute(owner), label: MODERATION_DECISION_COPY.viewShop }
      : null;
  }
  return null;
}

export function moderationAutomationCopy(
  decision: Pick<MarketplaceModerationDecision, 'automatedDetection' | 'automatedDecision'>,
): string {
  const { automation } = MODERATION_DECISION_COPY;
  if (decision.automatedDetection && decision.automatedDecision) return automation.detectedAndDecided;
  if (decision.automatedDetection) return automation.detectedOnly;
  if (decision.automatedDecision) return automation.decidedOnly;
  return automation.none;
}

/** The appeal email, with the decision's reference in the subject when it is known. */
export function moderationAppealHref(reference: string | null): string {
  const subject =
    reference === null ? MODERATION_DECISION_COPY.unreadableSubject : MODERATION_DECISION_COPY.appealSubject(reference);
  return `mailto:${COMPLAINT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Typography as="h3" className="text-sm font-semibold">
        {label}
      </Typography>
      {children}
    </div>
  );
}

function Body({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <Typography as="p" className="text-sm whitespace-pre-line text-muted-foreground" data-testid={testId}>
      {children}
    </Typography>
  );
}

/**
 * The statement of reasons on a `moderation_decision` notification: what was
 * restricted, where and for how long, when, why, on what facts, whether
 * automated means were used, and how to contest it. `decision` is null when
 * the service sent a statement this build cannot read; the card then still
 * points to the appeal route.
 */
export function MarketplaceModerationDecisionCard({
  decision,
  createdAt,
}: {
  decision: MarketplaceModerationDecision | null | undefined;
  createdAt: string;
}) {
  const copy = MODERATION_DECISION_COPY;
  return (
    <Card className="rounded-md p-0" data-testid="moderation-decision-card">
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center gap-4">
          <div className="rounded-full bg-amber-500/15 p-3 text-amber-600">
            <ShieldAlert className="size-5" />
          </div>
          <Typography as="h2" className="font-semibold">
            {copy.heading}
          </Typography>
          <time dateTime={createdAt} className="ml-auto text-xs text-muted-foreground">
            {formatDateTime(new Date(createdAt))}
          </time>
        </div>
        {decision ? (
          <ModerationDecisionDetails decision={decision} />
        ) : (
          <>
            <Body testId="moderation-decision-unreadable">{copy.unreadable(COMPLAINT_EMAIL)}</Body>
            <Link href={moderationAppealHref(null)} className="text-sm" data-testid="moderation-decision-appeal">
              {copy.appealAction}
            </Link>
            <Body>{copy.otherRedress}</Body>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ModerationDecisionDetails({ decision }: { decision: MarketplaceModerationDecision }) {
  const copy = MODERATION_DECISION_COPY;
  const target = moderationTargetLink(decision);
  return (
    <>
      <Section label={copy.whatLabel}>
        <Body testId="moderation-decision-restriction">{copy.restriction[decision.restriction]}</Body>
        {target ? (
          <Link href={target.href} className="text-sm">
            {target.label}
          </Link>
        ) : null}
      </Section>
      <Section label={copy.scopeLabel}>
        <Body>{decision.territorialScope}</Body>
      </Section>
      <Section label={copy.durationLabel}>
        <Body testId="moderation-decision-duration">
          {decision.endsAt ? copy.until(formatDateTime(new Date(decision.endsAt))) : copy.untilLifted}
        </Body>
      </Section>
      <Section label={copy.decidedLabel}>
        <Body>{formatDateTime(new Date(decision.decidedAt))}</Body>
      </Section>
      <Section label={copy.groundLabel}>
        <Body testId="moderation-decision-ground">{copy.ground[decision.ground](decision.groundReference)}</Body>
        <Body>{decision.explanation}</Body>
      </Section>
      <Section label={copy.factsLabel}>
        <Body testId="moderation-decision-basis">{copy.basis[decision.basis]}</Body>
        <Body>{decision.facts}</Body>
      </Section>
      <Section label={copy.automationLabel}>
        <Body testId="moderation-decision-automation">{moderationAutomationCopy(decision)}</Body>
        {decision.automatedMeans ? <Body>{decision.automatedMeans}</Body> : null}
      </Section>
      <Section label={copy.redressLabel}>
        <Body>{copy.appeal(COMPLAINT_EMAIL)}</Body>
        <Link href={moderationAppealHref(decision.id)} className="text-sm" data-testid="moderation-decision-appeal">
          {copy.appealAction}
        </Link>
        <Body>{copy.otherRedress}</Body>
      </Section>
      <Section label={copy.referenceLabel}>
        <Body testId="moderation-decision-reference">{decision.id}</Body>
      </Section>
    </>
  );
}
