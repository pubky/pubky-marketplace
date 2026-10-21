import { NextRequest, NextResponse } from 'next/server';
import { SUPPORT_FEEDBACK_MAX_REQUEST_BODY_BYTES } from '@/config/support-intake';
import { FeedbackController } from '@/controllers/feedback/feedback';
import type { TFeedbackSubmitParams } from '@/controllers/feedback/feedback.types';
import { readJsonBody } from '@/libs/api/read-json-body';
import { handleApiError } from '@/libs/api/route-error-handler';
import { admitSupportIntake, tooManyRequestsResponse } from '@/libs/api/support-intake-guards';
import { HttpStatusCode } from '@/libs/http/http.types';

/**
 * API Route for feedback submission
 *
 * This endpoint receives feedback from the UI and processes it through
 * the controller layer following Franky's architecture.
 *
 * Requests are limited per client address and across all clients, and the
 * body is capped in size; both are checked before the body is parsed.
 * Field validation is handled by the controller layer.
 */
export async function POST(request: NextRequest) {
  try {
    const admission = admitSupportIntake('feedback', request);
    if (!admission.ok) return tooManyRequestsResponse(admission.retryAfterSeconds);

    const read = await readJsonBody(request, SUPPORT_FEEDBACK_MAX_REQUEST_BODY_BYTES);
    if (!read.ok) return read.response;
    const { pubky, comment, name } = read.body;

    // Delegate to controller - fields are unchecked until it validates them
    await FeedbackController.submit({ pubky, comment, name } as TFeedbackSubmitParams);

    return NextResponse.json({ message: 'Success' });
  } catch (error) {
    return handleApiError(error, 'api.feedback.POST');
  }
}

export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST instead.' },
    { status: HttpStatusCode.METHOD_NOT_ALLOWED },
  );
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
