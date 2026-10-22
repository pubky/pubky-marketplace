import { type NextRequest, NextResponse } from 'next/server';
import {
  SUPPORT_INTAKE_LIMITS,
  SUPPORT_INTAKE_RATE_LIMIT_MAX_KEYS,
  SUPPORT_INTAKE_RATE_LIMIT_WINDOW_MS,
  type TSupportIntakeKind,
} from '@/config/support-intake';
import { trustedClientIp } from '@/libs/api/client-ip';
import { readJsonBody, type TReadJsonBodyResult } from '@/libs/api/read-json-body';
import { type TRateLimitDecision, WindowCounter } from '@/libs/api/window-counter';
import { HttpStatusCode } from '@/libs/http/http.types';
import { Logger } from '@/libs/logger/logger';

type TSupportIntakeLimiters = { perClient: WindowCounter; global: WindowCounter };

const GLOBAL_KEY = 'global';

function limiters(kind: TSupportIntakeKind): TSupportIntakeLimiters {
  const { perClientRequests, globalRequests } = SUPPORT_INTAKE_LIMITS[kind];
  return {
    perClient: new WindowCounter(
      perClientRequests,
      SUPPORT_INTAKE_RATE_LIMIT_WINDOW_MS,
      SUPPORT_INTAKE_RATE_LIMIT_MAX_KEYS,
    ),
    global: new WindowCounter(globalRequests, SUPPORT_INTAKE_RATE_LIMIT_WINDOW_MS, 1),
  };
}

const LIMITERS: Record<TSupportIntakeKind, TSupportIntakeLimiters> = {
  feedback: limiters('feedback'),
  report: limiters('report'),
  copyright: limiters('copyright'),
};

let warnedNoClientAddress = false;

/**
 * Counts one submission of a support form against its client's window and the
 * window shared by all clients. The shared window is only peeked until the
 * client window admits the request, so a request refused for its client never
 * spends shared quota. Without a trusted client address only the shared window
 * applies: unknown clients are not pooled under one key.
 */
export function admitSupportIntake(kind: TSupportIntakeKind, request: NextRequest): TRateLimitDecision {
  const { perClient, global } = LIMITERS[kind];

  const shared = global.peek(GLOBAL_KEY);
  if (!shared.ok) return shared;

  const clientIp = trustedClientIp(request);
  if (clientIp) {
    const client = perClient.consume(`ip:${clientIp}`, 1);
    if (!client.ok) return client;
  } else {
    warnNoClientAddressOnce();
  }

  return global.consume(GLOBAL_KEY, 1);
}

/**
 * Admits one submission of a support form, then reads its body within the
 * form's size cap. A refused request gets 429 before its body is read.
 */
export async function readSupportIntake(kind: TSupportIntakeKind, request: NextRequest): Promise<TReadJsonBodyResult> {
  const admission = admitSupportIntake(kind, request);
  if (!admission.ok) return { ok: false, response: tooManyRequestsResponse(admission.retryAfterSeconds) };
  return readJsonBody(request, SUPPORT_INTAKE_LIMITS[kind].maxBodyBytes);
}

export function resetSupportIntakeForTests(): void {
  for (const { perClient, global } of Object.values(LIMITERS)) {
    perClient.clear();
    global.clear();
  }
  warnedNoClientAddress = false;
}

function warnNoClientAddressOnce(): void {
  if (warnedNoClientAddress) return;
  warnedNoClientAddress = true;
  Logger.warn(
    '[support-intake] Per-client limits are off because no trusted proxy is configured; only the shared limit applies',
  );
}

function tooManyRequestsResponse(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests. Try again later.' },
    { status: HttpStatusCode.TOO_MANY_REQUESTS, headers: { 'Retry-After': String(retryAfterSeconds) } },
  );
}
