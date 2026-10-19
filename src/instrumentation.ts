import * as Sentry from '@sentry/nextjs';
import { AppError } from '@/libs/error/error';
import { getRuntimeConfig, warnIfModerationDisabled } from '@/libs/runtime-config/runtime-config';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Runtime config failures are unrecoverable until the container env changes. Next catches
    // instrumentation errors, so explicitly terminate the Node process to fail deploy health checks
    // instead of serving HTTP 500s from a "ready" container.
    try {
      const config = getRuntimeConfig();
      // Next invokes register when a server instance starts, not during next build.
      // Deployment preflight must start the configured instance before promoting it.
      const { assertEmbeddedShopDeployment } = await import('@/server/marketplace-grant/readiness');
      assertEmbeddedShopDeployment(config);
      warnIfModerationDisabled(config);
    } catch (error) {
      if (!(error instanceof AppError)) console.error(error);
      process.exit(1);
    }

    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Auto-captures unhandled errors from Server Components, Route Handlers, and middleware.
// Requires @sentry/nextjs >= 8.28.0 and Next.js >= 15.
export const onRequestError = Sentry.captureRequestError;
