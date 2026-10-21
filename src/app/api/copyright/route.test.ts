import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SUPPORT_COPYRIGHT_GLOBAL_RATE_LIMIT_REQUESTS,
  SUPPORT_COPYRIGHT_MAX_REQUEST_BODY_BYTES,
  SUPPORT_COPYRIGHT_RATE_LIMIT_REQUESTS,
} from '@/config/support-intake';
import { CopyrightController } from '@/controllers/copyright/copyright';
import { admitSupportIntake, resetSupportIntakeForTests } from '@/libs/api/support-intake-guards';
import { ServerErrorCode, ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import { HttpStatusCode } from '@/libs/http/http.types';
import { Logger } from '@/libs/logger/logger';
import { GET, OPTIONS, POST } from './route';

const testData = {
  nameOwner: 'John Doe',
  originalContentUrls: 'https://example.com/original',
  briefDescription: 'Original artwork',
  infringingContentUrl: 'https://example.com/infringing',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  phoneNumber: '123-456-7890',
  streetAddress: '123 Main St',
  country: 'United States',
  city: 'New York',
  stateProvince: 'NY',
  zipCode: '10001',
  signature: 'John Doe',
  isRightsOwner: true,
  isReportingOnBehalf: false,
};

const createPostRequest = (body: Record<string, unknown>) => {
  return new NextRequest('http://localhost:3000/api/copyright', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
};

describe('API Route: /api/copyright', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSupportIntakeForTests();
    vi.spyOn(CopyrightController, 'submit').mockResolvedValue(undefined);
    vi.spyOn(Logger, 'error').mockImplementation(() => {});
  });

  describe('POST', () => {
    it('should successfully submit copyright request', async () => {
      const request = createPostRequest(testData);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBe('Success');
      expect(CopyrightController.submit).toHaveBeenCalledWith(testData);
    });

    it('should handle validation errors with 500 status (no statusCode in context)', async () => {
      const appError = Err.validation(ValidationErrorCode.MISSING_FIELD, 'Validation failed', {
        service: ErrorService.Local,
        operation: 'validateNameOwner',
      });
      vi.spyOn(CopyrightController, 'submit').mockRejectedValue(appError);

      const request = createPostRequest(testData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(HttpStatusCode.INTERNAL_SERVER_ERROR);
      expect(data.error).toBe('Validation failed');
    });

    it('should handle AppError with statusCode in context', async () => {
      const appError = Err.server(ServerErrorCode.SERVICE_UNAVAILABLE, 'Service unavailable', {
        service: ErrorService.Chatwoot,
        operation: 'createConversation',
        context: { statusCode: 503 },
      });
      vi.spyOn(CopyrightController, 'submit').mockRejectedValue(appError);

      const request = createPostRequest(testData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.error).toBe('Service unavailable');
    });

    it('should handle unexpected errors with 500 status', async () => {
      vi.spyOn(CopyrightController, 'submit').mockRejectedValue(new Error('Unexpected error'));

      const request = createPostRequest(testData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(HttpStatusCode.INTERNAL_SERVER_ERROR);
      expect(data.error).toBe('Internal Server Error');
    });
  });

  describe('POST limits', () => {
    const validBody = testData;
    const requestFrom = (clientIp: string, body: Record<string, unknown> = validBody) =>
      new NextRequest('http://localhost:3000/api/copyright', {
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
      for (let i = 0; i < SUPPORT_COPYRIGHT_RATE_LIMIT_REQUESTS; i++) {
        expect((await POST(requestFrom('203.0.113.7'))).status).toBe(200);
      }

      const request = requestFrom('203.0.113.7');
      const response = await POST(request);

      expect(response.status).toBe(429);
      expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
      expect((await response.json()).error).toBe('Too many requests. Try again later.');
      expect(request.bodyUsed).toBe(false);
      expect(CopyrightController.submit).toHaveBeenCalledTimes(SUPPORT_COPYRIGHT_RATE_LIMIT_REQUESTS);
    });

    it('refuses every client with 429 once the shared window is used up', async () => {
      // Requests without a trusted client address count only against the shared window.
      for (let i = 0; i < SUPPORT_COPYRIGHT_GLOBAL_RATE_LIMIT_REQUESTS; i++) {
        admitSupportIntake('copyright', new NextRequest('http://localhost:3000/api/copyright', { method: 'POST' }));
      }

      const response = await POST(requestFrom('198.51.100.1'));

      expect(response.status).toBe(429);
      expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
      expect(CopyrightController.submit).not.toHaveBeenCalled();
    });

    it('refuses a body over the size cap with 413 before the controller runs', async () => {
      const oversized = { ...validBody, briefDescription: 'a'.repeat(SUPPORT_COPYRIGHT_MAX_REQUEST_BODY_BYTES) };

      const response = await POST(requestFrom('203.0.113.7', oversized));

      expect(response.status).toBe(413);
      expect((await response.json()).error).toBe('Request body is too large.');
      expect(CopyrightController.submit).not.toHaveBeenCalled();
    });
  });

  describe('GET', () => {
    it('should return 405 Method Not Allowed', async () => {
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(HttpStatusCode.METHOD_NOT_ALLOWED);
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
