import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportApplication } from '@/application/report/report';
import type { Pubky } from '@/models/models.types';
import {
  REPORT_ISSUE_TYPE_VALUES,
  REPORT_ISSUE_TYPES,
  REPORT_REASON_MAX_LENGTH,
  REVIEW_REPORT_ISSUE_TYPES,
} from '@/pipes/report/report.constants';
import { asInvalid } from '@/test-utils/type-assertions';
import type { TReportSubmitParams } from './report.types';

const testData = {
  userPubky: 'o1gg96ewuojmopcjbz8895478wdtxtzzuxnfjjz8o8e77csa1ngo' as Pubky,
  userName: 'Test User',
  postUrl: 'https://example.com/post/abc123',
};

const createReportParams = (overrides: Partial<TReportSubmitParams> = {}): TReportSubmitParams => ({
  pubky: testData.userPubky,
  postUrl: testData.postUrl,
  issueType: REPORT_ISSUE_TYPES.PERSONAL_INFO,
  reason: 'This post contains my personal information without consent',
  name: testData.userName,
  ...overrides,
});

describe('ReportController', () => {
  let ReportController: typeof import('./report').ReportController;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock ReportApplication
    vi.spyOn(ReportApplication, 'submit').mockResolvedValue(undefined);

    // Import ReportController
    const reportModule = await import('./report');
    ReportController = reportModule.ReportController;
  });

  describe('submit', () => {
    it('should pass validated params to application layer', async () => {
      const params = createReportParams();
      const submitSpy = vi.spyOn(ReportApplication, 'submit');

      await ReportController.submit(params);

      expect(submitSpy).toHaveBeenCalledWith({
        pubky: testData.userPubky,
        postUrl: testData.postUrl,
        issueType: REPORT_ISSUE_TYPES.PERSONAL_INFO,
        reason: params.reason,
        name: testData.userName,
      });
    });

    it('should pass a validated listing reference to the application layer', async () => {
      const submitSpy = vi.spyOn(ReportApplication, 'submit');

      await ReportController.submit(
        createReportParams({
          listingId: ' boots_01 ',
          sellerPubky: 'o1gg96ewuojmopcjbz8895478wdtxtzzuxnfjjz8o8e77csa1ngo',
        }),
      );

      expect(submitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          listing: { listingId: 'boots_01', sellerPubky: 'o1gg96ewuojmopcjbz8895478wdtxtzzuxnfjjz8o8e77csa1ngo' },
        }),
      );
    });

    it('should not add a listing to a post report', async () => {
      const submitSpy = vi.spyOn(ReportApplication, 'submit');

      await ReportController.submit(createReportParams());

      expect(submitSpy.mock.calls[0]?.[0]).not.toHaveProperty('listing');
    });

    it('should refuse a listing report that names only the listing', async () => {
      const submitSpy = vi.spyOn(ReportApplication, 'submit');

      await expect(ReportController.submit(createReportParams({ listingId: 'boots_01' }))).rejects.toThrow(
        'A listing report needs both the listing id and the seller pubky',
      );
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('should pass a validated review reference and review reason to the application layer', async () => {
      const submitSpy = vi.spyOn(ReportApplication, 'submit');
      const reviewer = 'a'.repeat(52);
      const reviewUri = `pubky://${reviewer}/pub/pubky.app/marketplace/v1/reviews/8Z8CWH8NVYQY39ZEBFGKQWWEKG`;

      await ReportController.submit(
        createReportParams({
          issueType: REVIEW_REPORT_ISSUE_TYPES.FAKE_REVIEW,
          reviewUri,
          reviewerPubky: reviewer,
          listingId: 'boots_01',
          sellerPubky: testData.userPubky,
        }),
      );

      expect(submitSpy).toHaveBeenCalledWith({
        pubky: testData.userPubky,
        postUrl: testData.postUrl,
        issueType: REVIEW_REPORT_ISSUE_TYPES.FAKE_REVIEW,
        reason: 'This post contains my personal information without consent',
        name: testData.userName,
        review: { reviewUri, reviewerPubky: reviewer, listingId: 'boots_01', sellerPubky: testData.userPubky },
      });
    });

    it('should refuse a post reason on a review report', async () => {
      const submitSpy = vi.spyOn(ReportApplication, 'submit');
      const reviewer = 'a'.repeat(52);

      await expect(
        ReportController.submit(
          createReportParams({
            issueType: REPORT_ISSUE_TYPES.ILLEGAL_SALES,
            reviewUri: `pubky://${reviewer}/pub/pubky.app/marketplace/v1/reviews/8Z8CWH8NVYQY39ZEBFGKQWWEKG`,
            reviewerPubky: reviewer,
            listingId: 'boots_01',
            sellerPubky: testData.userPubky,
          }),
        ),
      ).rejects.toThrow('Invalid review report reason');
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('should refuse a review reason on a post report', async () => {
      const submitSpy = vi.spyOn(ReportApplication, 'submit');

      await expect(
        ReportController.submit(createReportParams({ issueType: REVIEW_REPORT_ISSUE_TYPES.FAKE_REVIEW })),
      ).rejects.toThrow('Invalid issue type');
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('should accept all valid issue types', async () => {
      const submitSpy = vi.spyOn(ReportApplication, 'submit');

      for (const issueType of Object.values(REPORT_ISSUE_TYPES)) {
        submitSpy.mockClear();
        const params = createReportParams({ issueType });

        await ReportController.submit(params);

        expect(submitSpy).toHaveBeenCalledWith(expect.objectContaining({ issueType }));
      }
    });

    it('should throw when pubky is missing', async () => {
      const params = createReportParams({ pubky: '' as Pubky });

      await expect(ReportController.submit(params)).rejects.toThrow('Pubky is required and must be a non-empty string');
    });

    it('should throw when pubky is null', async () => {
      const params = createReportParams({ pubky: asInvalid<Pubky>(null) });

      await expect(ReportController.submit(params)).rejects.toThrow('Pubky is required and must be a non-empty string');
    });

    it('should throw when postUrl is missing', async () => {
      const params = createReportParams({ postUrl: '' });

      await expect(ReportController.submit(params)).rejects.toThrow(
        'Post URL is required and must be a non-empty string',
      );
    });

    it('should throw when postUrl is null', async () => {
      const params = createReportParams({ postUrl: asInvalid<string>(null) });

      await expect(ReportController.submit(params)).rejects.toThrow(
        'Post URL is required and must be a non-empty string',
      );
    });

    it('should throw when issueType is missing', async () => {
      const params = createReportParams({ issueType: '' });

      await expect(ReportController.submit(params)).rejects.toThrow(
        'Issue type is required and must be a non-empty string',
      );
    });

    it('should throw when issueType is null', async () => {
      const params = createReportParams({ issueType: asInvalid<string>(null) });

      await expect(ReportController.submit(params)).rejects.toThrow(
        'Issue type is required and must be a non-empty string',
      );
    });

    it('should throw when issueType is invalid', async () => {
      const params = createReportParams({ issueType: 'invalid-type' });

      await expect(ReportController.submit(params)).rejects.toThrow(
        `Invalid issue type. Must be one of: ${REPORT_ISSUE_TYPE_VALUES.join(', ')}`,
      );
    });

    it('should throw when reason is missing', async () => {
      const params = createReportParams({ reason: '' });

      await expect(ReportController.submit(params)).rejects.toThrow(
        'Reason is required and must be a non-empty string',
      );
    });

    it('should throw when reason is null', async () => {
      const params = createReportParams({ reason: asInvalid<string>(null) });

      await expect(ReportController.submit(params)).rejects.toThrow(
        'Reason is required and must be a non-empty string',
      );
    });

    it('should throw when reason exceeds max length', async () => {
      const longReason = 'a'.repeat(REPORT_REASON_MAX_LENGTH + 1);
      const params = createReportParams({ reason: longReason });

      await expect(ReportController.submit(params)).rejects.toThrow(
        `Reason must be no more than ${REPORT_REASON_MAX_LENGTH} characters`,
      );
    });

    it('should accept reason at max length', async () => {
      const maxLengthReason = 'a'.repeat(REPORT_REASON_MAX_LENGTH);
      const params = createReportParams({ reason: maxLengthReason });
      const submitSpy = vi.spyOn(ReportApplication, 'submit');

      await ReportController.submit(params);

      expect(submitSpy).toHaveBeenCalledWith(expect.objectContaining({ reason: maxLengthReason }));
    });

    it('should throw when name is missing', async () => {
      const params = createReportParams({ name: '' });

      await expect(ReportController.submit(params)).rejects.toThrow('Name is required and must be a non-empty string');
    });

    it('should throw when name is null', async () => {
      const params = createReportParams({ name: asInvalid<string>(null) });

      await expect(ReportController.submit(params)).rejects.toThrow('Name is required and must be a non-empty string');
    });

    it('should throw when application layer fails', async () => {
      vi.spyOn(ReportApplication, 'submit').mockRejectedValue(new Error('Application error'));

      const params = createReportParams();

      await expect(ReportController.submit(params)).rejects.toThrow('Application error');
    });

    it('should trim whitespace from inputs', async () => {
      const params = createReportParams({
        pubky: `  ${testData.userPubky}  ` as Pubky,
        postUrl: '  https://example.com/post  ',
        issueType: `  ${REPORT_ISSUE_TYPES.HATE_SPEECH}  `,
        reason: '  Some reason  ',
        name: '  Test User  ',
      });
      const submitSpy = vi.spyOn(ReportApplication, 'submit');

      await ReportController.submit(params);

      expect(submitSpy).toHaveBeenCalledWith({
        pubky: testData.userPubky,
        postUrl: 'https://example.com/post',
        issueType: REPORT_ISSUE_TYPES.HATE_SPEECH,
        reason: 'Some reason',
        name: 'Test User',
      });
    });
  });
});
