import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getMarketplaceListingRoute, getMarketplaceShopRoute } from '@/app/routes';
import { MODERATION_DECISION_COPY } from '@/config/commerce-copy';
import { COMPLAINT_EMAIL } from '@/config/legal';
import type { MarketplaceModerationDecision } from '@/services/marketplace/marketplace-projections';
import {
  MarketplaceModerationDecisionCard,
  moderationAppealHref,
  moderationAutomationCopy,
  moderationTargetLink,
} from './MarketplaceModerationDecisionCard';

const SELLER = 's'.repeat(52);

function decision(overrides: Partial<MarketplaceModerationDecision> = {}): MarketplaceModerationDecision {
  return {
    id: '6f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f',
    restriction: 'listing_removed',
    targetUri: `pubky://${SELLER}/pub/pubky.app/marketplace/v1/listings/lst_1`,
    territorialScope: 'Every region where Pubky Market is offered',
    endsAt: null,
    decidedAt: '2026-11-04T12:00:00.000Z',
    basis: 'notice',
    facts: 'A report said the listing offers a prescription-only medicine.',
    automatedDetection: false,
    automatedDecision: false,
    automatedMeans: null,
    ground: 'terms',
    groundReference: 'Pubky Terms of Service, Prohibited goods',
    explanation: 'The Terms prohibit listing anything that is illegal to offer.',
    ...overrides,
  };
}

describe('MarketplaceModerationDecisionCard', () => {
  it('shows every element of the statement of reasons and the appeal route', () => {
    render(<MarketplaceModerationDecisionCard decision={decision()} createdAt="2026-11-04T12:00:05.000Z" />);

    expect(screen.getByRole('heading', { name: MODERATION_DECISION_COPY.heading })).toBeInTheDocument();
    expect(screen.getByTestId('moderation-decision-restriction')).toHaveTextContent(
      MODERATION_DECISION_COPY.restriction.listing_removed,
    );
    expect(screen.getByRole('link', { name: MODERATION_DECISION_COPY.viewListing })).toHaveAttribute(
      'href',
      getMarketplaceListingRoute(SELLER, 'lst_1'),
    );
    expect(screen.getByText('Every region where Pubky Market is offered')).toBeInTheDocument();
    expect(screen.getByTestId('moderation-decision-duration')).toHaveTextContent(MODERATION_DECISION_COPY.untilLifted);
    expect(screen.getByTestId('moderation-decision-ground')).toHaveTextContent(
      'It breaks our Terms: Pubky Terms of Service, Prohibited goods.',
    );
    expect(screen.getByText('The Terms prohibit listing anything that is illegal to offer.')).toBeInTheDocument();
    expect(screen.getByTestId('moderation-decision-basis')).toHaveTextContent(MODERATION_DECISION_COPY.basis.notice);
    expect(screen.getByText('A report said the listing offers a prescription-only medicine.')).toBeInTheDocument();
    expect(screen.getByTestId('moderation-decision-automation')).toHaveTextContent(
      MODERATION_DECISION_COPY.automation.none,
    );
    expect(screen.getByText(MODERATION_DECISION_COPY.appeal(COMPLAINT_EMAIL))).toBeInTheDocument();
    expect(screen.getByTestId('moderation-decision-appeal')).toHaveAttribute(
      'href',
      `mailto:${COMPLAINT_EMAIL}?subject=Appeal%206f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f`,
    );
    expect(screen.getByText(MODERATION_DECISION_COPY.otherRedress)).toBeInTheDocument();
    expect(screen.getByTestId('moderation-decision-reference')).toHaveTextContent(
      '6f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f',
    );
  });

  it('states an end date, an illegal-content ground and the automated means when they apply', () => {
    render(
      <MarketplaceModerationDecisionCard
        decision={decision({
          endsAt: '2026-12-04T12:00:00.000Z',
          basis: 'own_initiative',
          automatedDetection: true,
          automatedMeans: 'An image classifier flagged the photos.',
          ground: 'illegal_content',
          groundReference: 'the applicable medicines law',
        })}
        createdAt="2026-11-04T12:00:05.000Z"
      />,
    );

    expect(screen.getByTestId('moderation-decision-duration')).not.toHaveTextContent(
      MODERATION_DECISION_COPY.untilLifted,
    );
    expect(screen.getByTestId('moderation-decision-ground')).toHaveTextContent(
      'It is illegal content under the applicable medicines law.',
    );
    expect(screen.getByTestId('moderation-decision-basis')).toHaveTextContent(
      MODERATION_DECISION_COPY.basis.own_initiative,
    );
    expect(screen.getByTestId('moderation-decision-automation')).toHaveTextContent(
      MODERATION_DECISION_COPY.automation.detectedOnly,
    );
    expect(screen.getByText('An image classifier flagged the photos.')).toBeInTheDocument();
  });

  it('still points to the appeal route when the statement cannot be read', () => {
    render(<MarketplaceModerationDecisionCard decision={null} createdAt="2026-11-04T12:00:05.000Z" />);
    expect(screen.getByTestId('moderation-decision-unreadable')).toHaveTextContent(
      MODERATION_DECISION_COPY.unreadable(COMPLAINT_EMAIL),
    );
  });
});

describe('moderation decision helpers', () => {
  it('links a removed listing and a suspended shop, and nothing for a review or a mismatched target', () => {
    expect(moderationTargetLink(decision())).toEqual({
      href: getMarketplaceListingRoute(SELLER, 'lst_1'),
      label: MODERATION_DECISION_COPY.viewListing,
    });
    expect(
      moderationTargetLink(
        decision({ restriction: 'shop_suspended', targetUri: `pubky://${SELLER}/pub/pubky.app/profile.json` }),
      ),
    ).toEqual({ href: getMarketplaceShopRoute(SELLER), label: MODERATION_DECISION_COPY.viewShop });
    expect(
      moderationTargetLink(
        decision({
          restriction: 'review_excluded',
          targetUri: `pubky://${SELLER}/pub/pubky.app/marketplace/v1/reviews/r1`,
        }),
      ),
    ).toBeNull();
    expect(
      moderationTargetLink(decision({ targetUri: `pubky://${SELLER}/pub/pubky.app/marketplace/v1/listings/a/b` })),
    ).toBeNull();
    expect(moderationTargetLink(decision({ targetUri: 'https://example.com/x' }))).toBeNull();
  });

  it('names how automated means were used', () => {
    const { automation } = MODERATION_DECISION_COPY;
    expect(moderationAutomationCopy({ automatedDetection: false, automatedDecision: false })).toBe(automation.none);
    expect(moderationAutomationCopy({ automatedDetection: true, automatedDecision: false })).toBe(
      automation.detectedOnly,
    );
    expect(moderationAutomationCopy({ automatedDetection: false, automatedDecision: true })).toBe(
      automation.decidedOnly,
    );
    expect(moderationAutomationCopy({ automatedDetection: true, automatedDecision: true })).toBe(
      automation.detectedAndDecided,
    );
  });

  it('builds the appeal email with the reference in the subject', () => {
    expect(moderationAppealHref('abc')).toBe(`mailto:${COMPLAINT_EMAIL}?subject=Appeal%20abc`);
  });
});
