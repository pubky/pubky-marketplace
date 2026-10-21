import { NextRequest, NextResponse } from 'next/server';
import { SUPPORT_COPYRIGHT_MAX_REQUEST_BODY_BYTES } from '@/config/support-intake';
import { CopyrightController } from '@/controllers/copyright/copyright';
import type { TCopyrightSubmitParams } from '@/controllers/copyright/copyright.types';
import { readJsonBody } from '@/libs/api/read-json-body';
import { handleApiError } from '@/libs/api/route-error-handler';
import { admitSupportIntake, tooManyRequestsResponse } from '@/libs/api/support-intake-guards';
import { HttpStatusCode } from '@/libs/http/http.types';

/**
 * API Route for copyright/DMCA takedown request submission to Chatwoot
 *
 * This endpoint receives copyright form data from the UI and processes it through
 * the controller layer following Franky's architecture.
 *
 * Requests are limited per client address and across all clients, and the
 * body is capped in size; both are checked before the body is parsed.
 * Field validation is handled by the controller layer.
 */
export async function POST(request: NextRequest) {
  try {
    const admission = admitSupportIntake('copyright', request);
    if (!admission.ok) return tooManyRequestsResponse(admission.retryAfterSeconds);

    const read = await readJsonBody(request, SUPPORT_COPYRIGHT_MAX_REQUEST_BODY_BYTES);
    if (!read.ok) return read.response;
    const {
      nameOwner,
      originalContentUrls,
      briefDescription,
      infringingContentUrl,
      firstName,
      lastName,
      email,
      phoneNumber,
      streetAddress,
      country,
      city,
      stateProvince,
      zipCode,
      signature,
      isRightsOwner,
      isReportingOnBehalf,
    } = read.body;

    // Delegate to controller - fields are unchecked until it validates them
    await CopyrightController.submit({
      nameOwner,
      originalContentUrls,
      briefDescription,
      infringingContentUrl,
      firstName,
      lastName,
      email,
      phoneNumber,
      streetAddress,
      country,
      city,
      stateProvince,
      zipCode,
      signature,
      isRightsOwner,
      isReportingOnBehalf,
    } as TCopyrightSubmitParams);

    return NextResponse.json({ message: 'Success' });
  } catch (error) {
    return handleApiError(error, 'api.copyright.POST');
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
