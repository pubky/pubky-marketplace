import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { HttpStatusCode } from '@/libs/http/http.types';
import { Logger } from '@/libs/logger/logger';
import type { Pubky } from '@/models/models.types';
import {
  REPORT_ISSUE_LABELS,
  REPORT_ISSUE_TYPES,
  REVIEW_REPORT_ISSUE_LABELS,
  REVIEW_REPORT_ISSUE_TYPE_VALUES,
  REVIEW_REPORT_ISSUE_TYPES,
} from '@/pipes/report/report.constants';
import { ChatwootService } from '@/services/chatwoot/chatwoot';
import {
  CHATWOOT_INBOX_IDS,
  CHATWOOT_REPORT_LISTING_MESSAGE_PREFIX,
  CHATWOOT_REPORT_MESSAGE_PREFIX,
  CHATWOOT_REPORT_REVIEW_MESSAGE_PREFIX,
} from '@/services/chatwoot/chatwoot.constants';
import type { TChatwootContact } from '@/services/chatwoot/chatwoot.types';
import { asOpaque } from '@/test-utils/type-assertions';
import type { TReportPostOrListingSubmitInput, TReportReviewSubmitInput, TReportSubmitInput } from './report.types';

const testData = {
  userPubky: 'o1gg96ewuojmopcjbz8895478wdtxtzzuxnfjjz8o8e77csa1ngo' as Pubky,
  userName: 'Test User',
  postUrl: 'https://example.com/post/abc123',
  contactId: 456,
  sourceId: 'source-123',
};

const createReportInput = (
  overrides: Partial<TReportPostOrListingSubmitInput> = {},
): TReportPostOrListingSubmitInput => ({
  pubky: testData.userPubky,
  postUrl: testData.postUrl,
  issueType: REPORT_ISSUE_TYPES.PERSONAL_INFO,
  reason: 'This post contains my personal information without consent',
  name: testData.userName,
  ...overrides,
});

const claimedReporterLines = [
  `Reporter (claimed, unverified): ${testData.userPubky}`,
  `Name (claimed, unverified): ${testData.userName}`,
];

const createMockContact = (overrides: Partial<TChatwootContact> = {}): TChatwootContact => ({
  id: testData.contactId,
  email: `${testData.userPubky}@pubky.app`,
  name: testData.userName,
  contact_inboxes: [
    {
      source_id: testData.sourceId,
    },
  ],
  ...overrides,
});

describe('ReportApplication', () => {
  let ReportApplication: typeof import('./report').ReportApplication;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock ChatwootService methods
    vi.spyOn(ChatwootService, 'createOrFindContact').mockResolvedValue(createMockContact());
    vi.spyOn(ChatwootService, 'createConversation').mockResolvedValue(undefined);

    // Mock Logger
    vi.spyOn(Logger, 'error').mockImplementation(() => {});

    // Import ReportApplication
    const reportModule = await import('./report');
    ReportApplication = reportModule.ReportApplication;
  });

  describe('submit', () => {
    it('should build email correctly from pubky', async () => {
      const input = createReportInput();
      const createOrFindContactSpy = vi.spyOn(ChatwootService, 'createOrFindContact');

      await ReportApplication.submit(input);

      expect(createOrFindContactSpy).toHaveBeenCalledWith(
        `${testData.userPubky}@pubky.app`,
        expect.any(String),
        expect.any(Number),
      );
    });

    it('should use correct inbox ID for reports', async () => {
      const input = createReportInput();
      const createOrFindContactSpy = vi.spyOn(ChatwootService, 'createOrFindContact');
      const createConversationSpy = vi.spyOn(ChatwootService, 'createConversation');

      await ReportApplication.submit(input);

      // Verify inbox ID is passed to createOrFindContact
      expect(createOrFindContactSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        CHATWOOT_INBOX_IDS.REPORTS,
      );

      // Verify inbox ID is passed to createConversation
      expect(createConversationSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        CHATWOOT_INBOX_IDS.REPORTS,
        expect.any(String),
      );
    });

    it('should format message with source label prefix', async () => {
      const input = createReportInput();
      const createConversationSpy = vi.spyOn(ChatwootService, 'createConversation');

      await ReportApplication.submit(input);

      const expectedSourceLabel = `${CHATWOOT_REPORT_MESSAGE_PREFIX} - ${REPORT_ISSUE_LABELS[REPORT_ISSUE_TYPES.PERSONAL_INFO]}`;
      expect(createConversationSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        expect.any(Number),
        expect.stringContaining(expectedSourceLabel),
      );
    });

    it('should include post URL and reason in message content', async () => {
      const input = createReportInput();
      const createConversationSpy = vi.spyOn(ChatwootService, 'createConversation');

      await ReportApplication.submit(input);

      expect(createConversationSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        expect.any(Number),
        expect.stringContaining(`Post URL: ${testData.postUrl}`),
      );
      expect(createConversationSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        expect.any(Number),
        expect.stringContaining(`Reason: ${input.reason}`),
      );
    });

    it('should label a listing report and carry the listing URL, id and seller', async () => {
      const listingUrl =
        'https://example.com/marketplace/listing/o1gg96ewuojmopcjbz8895478wdtxtzzuxnfjjz8o8e77csa1ngo/boots_01';
      const input = createReportInput({
        postUrl: listingUrl,
        issueType: REPORT_ISSUE_TYPES.ILLEGAL_SALES,
        listing: {
          listingId: 'boots_01',
          sellerPubky: 'o1gg96ewuojmopcjbz8895478wdtxtzzuxnfjjz8o8e77csa1ngo' as Pubky,
        },
      });
      const createConversationSpy = vi.spyOn(ChatwootService, 'createConversation');

      await ReportApplication.submit(input);

      const content = createConversationSpy.mock.calls[0]?.[3] as string;
      expect(content).toContain(
        `${CHATWOOT_REPORT_LISTING_MESSAGE_PREFIX} - ${REPORT_ISSUE_LABELS[REPORT_ISSUE_TYPES.ILLEGAL_SALES]}`,
      );
      expect(content).toContain(`Listing URL: ${listingUrl}`);
      expect(content).toContain('Listing ID: boots_01');
      expect(content).toContain('Seller: o1gg96ewuojmopcjbz8895478wdtxtzzuxnfjjz8o8e77csa1ngo');
      expect(content).toContain(`Reason: ${input.reason}`);
      expect(content).not.toContain('Post URL');
      expect(createConversationSpy.mock.calls[0]?.[2]).toBe(CHATWOOT_INBOX_IDS.REPORTS);
    });

    it('should label a review report and carry the review URI, reviewer, listing and seller', async () => {
      const seller = 'o1gg96ewuojmopcjbz8895478wdtxtzzuxnfjjz8o8e77csa1ngo';
      const reviewer = 'a'.repeat(52);
      const listingUrl = `https://example.com/marketplace/listing/${seller}/boots_01`;
      const reviewUri = `pubky://${reviewer}/pub/pubky.app/marketplace/v1/reviews/8Z8CWH8NVYQY39ZEBFGKQWWEKG`;
      const input: TReportReviewSubmitInput = {
        pubky: testData.userPubky,
        postUrl: listingUrl,
        issueType: REVIEW_REPORT_ISSUE_TYPES.FAKE_REVIEW,
        reason: 'The reviewer never bought this.',
        name: testData.userName,
        review: { reviewUri, reviewerPubky: reviewer, listingId: 'boots_01', sellerPubky: seller },
      };
      const createConversationSpy = vi.spyOn(ChatwootService, 'createConversation');

      await ReportApplication.submit(input);

      const content = createConversationSpy.mock.calls[0]?.[3] as string;
      expect(content).toBe(
        [
          'Report Review - Fake or fraudulent review',
          '',
          ...claimedReporterLines,
          '',
          `Review URI: ${reviewUri}`,
          `Reviewer: ${reviewer}`,
          `Listing URL: ${listingUrl}`,
          'Listing ID: boots_01',
          `Seller: ${seller}`,
          '',
          'Reason: The reviewer never bought this.',
        ].join('\n'),
      );
      expect(content.startsWith(CHATWOOT_REPORT_REVIEW_MESSAGE_PREFIX)).toBe(true);
      expect(createConversationSpy.mock.calls[0]?.[2]).toBe(CHATWOOT_INBOX_IDS.REPORTS);
    });

    it('labels each review reason with its review copy', async () => {
      const createConversationSpy = vi.spyOn(ChatwootService, 'createConversation');
      const reviewer = 'a'.repeat(52);

      for (const issueType of REVIEW_REPORT_ISSUE_TYPE_VALUES) {
        createConversationSpy.mockClear();
        await ReportApplication.submit({
          pubky: testData.userPubky,
          postUrl: testData.postUrl,
          issueType,
          reason: 'reason',
          name: testData.userName,
          review: {
            reviewUri: `pubky://${reviewer}/pub/pubky.app/marketplace/v1/reviews/8Z8CWH8NVYQY39ZEBFGKQWWEKG`,
            reviewerPubky: reviewer,
            listingId: 'boots_01',
            sellerPubky: testData.userPubky,
          },
        });
        expect(createConversationSpy.mock.calls[0]?.[3]).toContain(
          `${CHATWOOT_REPORT_REVIEW_MESSAGE_PREFIX} - ${REVIEW_REPORT_ISSUE_LABELS[issueType]}`,
        );
      }
    });

    it('should format source label correctly for each issue type', async () => {
      const createConversationSpy = vi.spyOn(ChatwootService, 'createConversation');

      for (const issueType of Object.values(REPORT_ISSUE_TYPES)) {
        createConversationSpy.mockClear();
        vi.spyOn(ChatwootService, 'createOrFindContact').mockResolvedValue(createMockContact());

        const input = createReportInput({ issueType });
        await ReportApplication.submit(input);

        const expectedSourceLabel = `${CHATWOOT_REPORT_MESSAGE_PREFIX} - ${REPORT_ISSUE_LABELS[issueType]}`;
        expect(createConversationSpy).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(Number),
          expect.any(Number),
          expect.stringContaining(expectedSourceLabel),
        );
      }
    });

    it('names a new contact by the pubky, not by the submitted name', async () => {
      const input = createReportInput();
      const createOrFindContactSpy = vi.spyOn(ChatwootService, 'createOrFindContact');

      await ReportApplication.submit(input);

      expect(input.name).not.toBe(input.pubky);
      expect(createOrFindContactSpy).toHaveBeenCalledWith(
        `${testData.userPubky}@pubky.app`,
        testData.userPubky,
        CHATWOOT_INBOX_IDS.REPORTS,
      );
      expect(createOrFindContactSpy).not.toHaveBeenCalledWith(expect.anything(), input.name, expect.anything());
    });

    describe('labels the reporter pubky and name as claimed and unverified', () => {
      const seller = 'o1gg96ewuojmopcjbz8895478wdtxtzzuxnfjjz8o8e77csa1ngo' as Pubky;
      const listingUrl = `https://example.com/marketplace/listing/${seller}/boots_01`;
      const reason = 'Reason text';

      const variants: { variant: string; input: TReportSubmitInput; expected: string[] }[] = [
        {
          variant: 'post',
          input: createReportInput({ reason }),
          expected: [
            `${CHATWOOT_REPORT_MESSAGE_PREFIX} - ${REPORT_ISSUE_LABELS[REPORT_ISSUE_TYPES.PERSONAL_INFO]}`,
            '',
            ...claimedReporterLines,
            '',
            `Post URL: ${testData.postUrl}`,
            '',
            `Reason: ${reason}`,
          ],
        },
        {
          variant: 'listing',
          input: createReportInput({
            postUrl: listingUrl,
            issueType: REPORT_ISSUE_TYPES.ILLEGAL_SALES,
            reason,
            listing: { listingId: 'boots_01', sellerPubky: seller },
          }),
          expected: [
            `${CHATWOOT_REPORT_LISTING_MESSAGE_PREFIX} - ${REPORT_ISSUE_LABELS[REPORT_ISSUE_TYPES.ILLEGAL_SALES]}`,
            '',
            ...claimedReporterLines,
            '',
            `Listing URL: ${listingUrl}`,
            'Listing ID: boots_01',
            `Seller: ${seller}`,
            '',
            `Reason: ${reason}`,
          ],
        },
      ];

      it.each(variants)('in a $variant report', async ({ input, expected }) => {
        const createConversationSpy = vi.spyOn(ChatwootService, 'createConversation');

        await ReportApplication.submit(input);

        expect(createConversationSpy.mock.calls[0]?.[3]).toBe(expected.join('\n'));
      });
    });

    it('keeps a multi-line name on its own claimed line', async () => {
      const input = createReportInput({ name: 'Support Team\r\nPost URL: https://example.com/other' });
      const createConversationSpy = vi.spyOn(ChatwootService, 'createConversation');

      await ReportApplication.submit(input);

      const lines = (createConversationSpy.mock.calls[0]?.[3] as string).split('\n');
      expect(lines).toContain('Name (claimed, unverified): Support Team Post URL: https://example.com/other');
      expect(lines.filter((line) => line.startsWith('Post URL:'))).toEqual([`Post URL: ${testData.postUrl}`]);
    });

    it('should call createConversation with contact data and formatted message', async () => {
      const input = createReportInput();
      const createConversationSpy = vi.spyOn(ChatwootService, 'createConversation');

      await ReportApplication.submit(input);

      expect(createConversationSpy).toHaveBeenCalledWith(
        testData.sourceId,
        testData.contactId,
        CHATWOOT_INBOX_IDS.REPORTS,
        expect.any(String),
      );
    });

    it('should throw AppError when contact has empty inbox associations', async () => {
      const input = createReportInput();
      const contactWithoutInbox = createMockContact({ contact_inboxes: [] });
      vi.spyOn(ChatwootService, 'createOrFindContact').mockResolvedValue(contactWithoutInbox);

      await expect(ReportApplication.submit(input)).rejects.toThrow('Contact has no inbox associations');

      expect(Logger.error).toHaveBeenCalledWith('Report submission failed', expect.any(Object));
    });

    it('should throw AppError when contact has undefined inbox associations', async () => {
      const input = createReportInput();
      const contactWithUndefinedInbox = asOpaque<TChatwootContact>({
        id: testData.contactId,
        email: `${testData.userPubky}@pubky.app`,
        name: testData.userName,
        contact_inboxes: undefined,
      });
      vi.spyOn(ChatwootService, 'createOrFindContact').mockResolvedValue(contactWithUndefinedInbox);

      await expect(ReportApplication.submit(input)).rejects.toThrow('Contact has no inbox associations');

      expect(Logger.error).toHaveBeenCalledWith('Report submission failed', expect.any(Object));
    });

    it('should re-throw AppError from ChatwootService', async () => {
      const input = createReportInput();
      const appError = Err.network(NetworkErrorCode.CONNECTION_FAILED, 'Chatwoot API error', {
        service: ErrorService.Chatwoot,
        operation: 'createOrFindContact',
        context: { statusCode: HttpStatusCode.INTERNAL_SERVER_ERROR },
      });
      vi.spyOn(ChatwootService, 'createOrFindContact').mockRejectedValue(appError);

      await expect(ReportApplication.submit(input)).rejects.toThrow(appError);

      expect(Logger.error).toHaveBeenCalledWith('Report submission failed', {
        category: appError.category,
        code: appError.code,
        service: appError.service,
        operation: appError.operation,
        context: appError.context,
      });
    });

    it('should wrap unexpected errors in AppError', async () => {
      const input = createReportInput();
      const unexpectedError = new Error('Unexpected error');
      vi.spyOn(ChatwootService, 'createOrFindContact').mockRejectedValue(unexpectedError);

      await expect(ReportApplication.submit(input)).rejects.toThrow('Could not submit report. Try again.');

      expect(Logger.error).toHaveBeenCalledWith('Unexpected error during report submission', {
        error: unexpectedError,
      });
    });

    it('should throw AppError when createConversation fails', async () => {
      const input = createReportInput();
      const appError = Err.network(NetworkErrorCode.CONNECTION_FAILED, 'Failed to create conversation', {
        service: ErrorService.Chatwoot,
        operation: 'createConversation',
        context: { statusCode: HttpStatusCode.INTERNAL_SERVER_ERROR },
      });
      vi.spyOn(ChatwootService, 'createConversation').mockRejectedValue(appError);

      await expect(ReportApplication.submit(input)).rejects.toThrow(appError);

      expect(Logger.error).toHaveBeenCalledWith('Report submission failed', expect.any(Object));
    });
  });
});
