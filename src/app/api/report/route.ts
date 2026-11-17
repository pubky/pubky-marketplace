import { NextRequest, NextResponse } from 'next/server';
import { ReportController } from '@/controllers/report/report';
import type { TReportSubmitParams } from '@/controllers/report/report.types';
import { handleApiError } from '@/libs/api/route-error-handler';
import { readSupportIntake } from '@/libs/api/support-intake-guards';
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
    const intake = await readSupportIntake('report', request);
    if (!intake.ok) return intake.response;
    const { pubky, postUrl, issueType, reason, name, listingId, sellerPubky, reviewUri, reviewerPubky } = intake.body;

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
