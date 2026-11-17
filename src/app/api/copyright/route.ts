import { NextRequest, NextResponse } from 'next/server';
import { CopyrightController } from '@/controllers/copyright/copyright';
import type { TCopyrightSubmitParams } from '@/controllers/copyright/copyright.types';
import { handleApiError } from '@/libs/api/route-error-handler';
import { readSupportIntake } from '@/libs/api/support-intake-guards';
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
    const intake = await readSupportIntake('copyright', request);
    if (!intake.ok) return intake.response;
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
    } = intake.body;

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
