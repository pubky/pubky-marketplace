import { type NextRequest, NextResponse } from 'next/server';
import {
  SUPPORT_COPYRIGHT_GLOBAL_RATE_LIMIT_REQUESTS,
  SUPPORT_COPYRIGHT_RATE_LIMIT_REQUESTS,
  SUPPORT_FEEDBACK_GLOBAL_RATE_LIMIT_REQUESTS,
  SUPPORT_FEEDBACK_RATE_LIMIT_REQUESTS,
  SUPPORT_INTAKE_RATE_LIMIT_MAX_KEYS,
  SUPPORT_INTAKE_RATE_LIMIT_WINDOW_MS,
  SUPPORT_REPORT_GLOBAL_RATE_LIMIT_REQUESTS,
  SUPPORT_REPORT_RATE_LIMIT_REQUESTS,
} from '@/config/support-intake';
import { trustedClientIp } from '@/libs/api/import-route-guards';
import { type TRateLimitDecision, WindowCounter } from '@/libs/api/window-counter';
import { HttpStatusCode } from '@/libs/http/http.types';
import { Logger } from '@/libs/logger/logger';

export type TSupportIntakeKind = 'feedback' | 'report' | 'copyright';

type TSupportIntakeLimiters = { perClient: WindowCounter; global: WindowCounter };

const GLOBAL_KEY = 'global';

function limiters(perClientRequests: number, globalRequests: number): TSupportIntakeLimiters {
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
  feedback: limiters(SUPPORT_FEEDBACK_RATE_LIMIT_REQUESTS, SUPPORT_FEEDBACK_GLOBAL_RATE_LIMIT_REQUESTS),
  report: limiters(SUPPORT_REPORT_RATE_LIMIT_REQUESTS, SUPPORT_REPORT_GLOBAL_RATE_LIMIT_REQUESTS),
  copyright: limiters(SUPPORT_COPYRIGHT_RATE_LIMIT_REQUESTS, SUPPORT_COPYRIGHT_GLOBAL_RATE_LIMIT_REQUESTS),
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

export function tooManyRequestsResponse(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests. Try again later.' },
    { status: HttpStatusCode.TOO_MANY_REQUESTS, headers: { 'Retry-After': String(retryAfterSeconds) } },
  );
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
