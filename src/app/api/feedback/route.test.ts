import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FEEDBACK_MAX_CHARACTER_LENGTH } from '@/config/posts';
import { SUPPORT_INTAKE_LIMITS } from '@/config/support-intake';
import { FeedbackController } from '@/controllers/feedback/feedback';
import { admitSupportIntake, resetSupportIntakeForTests } from '@/libs/api/support-intake-guards';
import { ServerErrorCode, ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import type { Pubky } from '@/models/models.types';
import { GET, OPTIONS, POST } from './route';

const testData = {
  userPubky: 'o1gg96ewuojmopcjbz8895478wdtxtzzuxnfjjz8o8e77csa1ngo' as Pubky,
  userName: 'Test User',
  comment: 'This is a test feedback comment',
};

const createPostRequest = (body: Record<string, unknown>) => {
  return new NextRequest('http://localhost:3000/api/feedback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
};

describe('API Route: /api/feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSupportIntakeForTests();
    vi.spyOn(FeedbackController, 'submit').mockResolvedValue(undefined);
  });

  describe('POST', () => {
    it('should successfully submit feedback', async () => {
      const request = createPostRequest({
        pubky: testData.userPubky,
        comment: testData.comment,
        name: testData.userName,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe('Success');
      expect(FeedbackController.submit).toHaveBeenCalledWith({
        pubky: testData.userPubky,
        comment: testData.comment,
        name: testData.userName,
      });
    });

    it('should handle AppError from application layer with correct status code', async () => {
      const appError = Err.validation(ValidationErrorCode.INVALID_INPUT, 'Validation failed', {
        service: ErrorService.Local,
        operation: 'submit',
        context: { statusCode: 400 },
      });
      vi.spyOn(FeedbackController, 'submit').mockRejectedValue(appError);

      const request = createPostRequest({
        pubky: testData.userPubky,
        comment: testData.comment,
        name: testData.userName,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Validation failed');
    });

    it('should handle AppError with different status codes', async () => {
      const appError = Err.server(ServerErrorCode.INTERNAL_ERROR, 'Server error', {
        service: ErrorService.Local,
        operation: 'submit',
        context: { statusCode: 500 },
      });
      vi.spyOn(FeedbackController, 'submit').mockRejectedValue(appError);

      const request = createPostRequest({
        pubky: testData.userPubky,
        comment: testData.comment,
        name: testData.userName,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Server error');
    });

    it('should handle unexpected errors with 500 status', async () => {
      vi.spyOn(FeedbackController, 'submit').mockRejectedValue(new Error('Unexpected error'));

      const request = createPostRequest({
        pubky: testData.userPubky,
        comment: testData.comment,
        name: testData.userName,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Internal Server Error');
    });

    it('should reject an invalid JSON body with 400', async () => {
      const request = new NextRequest('http://localhost:3000/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: 'invalid json',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Request body is not valid JSON.');
      expect(FeedbackController.submit).not.toHaveBeenCalled();
    });

    it('should handle missing pubky in body', async () => {
      const request = createPostRequest({
        comment: testData.comment,
        name: testData.userName,
      });

      // The controller will validate and throw AppError
      const appError = Err.validation(
        ValidationErrorCode.INVALID_INPUT,
        'Pubky is required and must be a non-empty string',
        { service: ErrorService.Local, operation: 'submit', context: { statusCode: 400 } },
      );
      vi.spyOn(FeedbackController, 'submit').mockRejectedValue(appError);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Pubky is required and must be a non-empty string');
    });

    it('should handle missing comment in body', async () => {
      const request = createPostRequest({
        pubky: testData.userPubky,
        name: testData.userName,
      });

      // The controller will validate and throw AppError
      const appError = Err.validation(
        ValidationErrorCode.INVALID_INPUT,
        'Comment is required and must be a non-empty string',
        { service: ErrorService.Local, operation: 'submit', context: { statusCode: 400 } },
      );
      vi.spyOn(FeedbackController, 'submit').mockRejectedValue(appError);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Comment is required and must be a non-empty string');
    });

    it('should handle missing name in body', async () => {
      const request = createPostRequest({
        pubky: testData.userPubky,
        comment: testData.comment,
      });

      // The controller will validate and throw AppError
      const appError = Err.validation(
        ValidationErrorCode.INVALID_INPUT,
        'Name is required and must be a non-empty string',
        { service: ErrorService.Local, operation: 'submit', context: { statusCode: 400 } },
      );
      vi.spyOn(FeedbackController, 'submit').mockRejectedValue(appError);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Name is required and must be a non-empty string');
    });

    it('should handle comment exceeding max length', async () => {
      const longComment = 'a'.repeat(FEEDBACK_MAX_CHARACTER_LENGTH + 1);
      const request = createPostRequest({
        pubky: testData.userPubky,
        comment: longComment,
        name: testData.userName,
      });

      // The controller will validate and throw AppError
      const appError = Err.validation(
        ValidationErrorCode.INVALID_INPUT,
        `Comment must be no more than ${FEEDBACK_MAX_CHARACTER_LENGTH} characters`,
        { service: ErrorService.Local, operation: 'submit', context: { statusCode: 400 } },
      );
      vi.spyOn(FeedbackController, 'submit').mockRejectedValue(appError);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe(`Comment must be no more than ${FEEDBACK_MAX_CHARACTER_LENGTH} characters`);
    });
  });

  describe('POST limits', () => {
    const validBody = { pubky: testData.userPubky, comment: testData.comment, name: testData.userName };
    const requestFrom = (clientIp: string, body: Record<string, unknown> = validBody) =>
      new NextRequest('http://localhost:3000/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': clientIp },
        body: JSON.stringify(body),
      });

    beforeEach(() => {
      vi.stubEnv('VERCEL', undefined);
      vi.stubEnv('SHOP_BFF_CLI_TRUSTED_PROXY_COUNT', '1');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('refuses a client with 429 once its window is used up, before reading the body', async () => {
      for (let i = 0; i < SUPPORT_INTAKE_LIMITS.feedback.perClientRequests; i++) {
        expect((await POST(requestFrom('203.0.113.7'))).status).toBe(200);
      }

      const request = requestFrom('203.0.113.7');
      const response = await POST(request);

      expect(response.status).toBe(429);
      expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
      expect((await response.json()).error).toBe('Too many requests. Try again later.');
      expect(request.bodyUsed).toBe(false);
      expect(FeedbackController.submit).toHaveBeenCalledTimes(SUPPORT_INTAKE_LIMITS.feedback.perClientRequests);
    });

    it('refuses every client with 429 once the shared window is used up', async () => {
      // Requests without a trusted client address count only against the shared window.
      for (let i = 0; i < SUPPORT_INTAKE_LIMITS.feedback.globalRequests; i++) {
        admitSupportIntake('feedback', new NextRequest('http://localhost:3000/api/feedback', { method: 'POST' }));
      }

      const response = await POST(requestFrom('198.51.100.1'));

      expect(response.status).toBe(429);
      expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
      expect(FeedbackController.submit).not.toHaveBeenCalled();
    });

    it('refuses a body over the size cap with 413 before the controller runs', async () => {
      const oversized = { ...validBody, comment: 'a'.repeat(SUPPORT_INTAKE_LIMITS.feedback.maxBodyBytes) };

      const response = await POST(requestFrom('203.0.113.7', oversized));

      expect(response.status).toBe(413);
      expect((await response.json()).error).toBe('Request body is too large.');
      expect(FeedbackController.submit).not.toHaveBeenCalled();
    });
  });

  describe('GET', () => {
    it('should return 405 Method Not Allowed', async () => {
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(405);
      expect(data.error).toBe('Method not allowed. Use POST instead.');
    });
  });

  describe('OPTIONS', () => {
    it('should return CORS headers', async () => {
      const response = await OPTIONS();

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
    });
  });
});
