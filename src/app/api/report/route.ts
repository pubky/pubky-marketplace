import { NextRequest, NextResponse } from 'next/server';
import { SUPPORT_REPORT_MAX_REQUEST_BODY_BYTES } from '@/config/support-intake';
import { ReportController } from '@/controllers/report/report';
import type { TReportSubmitParams } from '@/controllers/report/report.types';
import { readJsonBody } from '@/libs/api/read-json-body';
import { handleApiError } from '@/libs/api/route-error-handler';
import { admitSupportIntake, tooManyRequestsResponse } from '@/libs/api/support-intake-guards';
import { HttpStatusCode } from '@/libs/http/http.types';

/**
 * API Route for post, listing and review report submission to Chatwoot
 *
 * This endpoint receives report data from the UI and processes it through
 * the controller layer following Franky's architecture.
 *
 * Requests are limited per client address and across all clients, and the
 * body is capped in size; both are checked before the body is parsed.
 * Field validation is handled by the controller layer.
 */
export async function POST(request: NextRequest) {
  try {
    const admission = admitSupportIntake('report', request);
    if (!admission.ok) return tooManyRequestsResponse(admission.retryAfterSeconds);

    const read = await readJsonBody(request, SUPPORT_REPORT_MAX_REQUEST_BODY_BYTES);
    if (!read.ok) return read.response;
    const { pubky, postUrl, issueType, reason, name, listingId, sellerPubky, reviewUri, reviewerPubky } = read.body;

    // Delegate to controller - fields are unchecked until it validates them
    await ReportController.submit({
      pubky,
      postUrl,
      issueType,
      reason,
      name,
      listingId,
      sellerPubky,
      reviewUri,
      reviewerPubky,
    } as TReportSubmitParams);

    return NextResponse.json({ message: 'Success' });
  } catch (error) {
    return handleApiError(error, 'api.report.POST');
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
