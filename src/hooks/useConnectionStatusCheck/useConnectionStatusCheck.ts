'use client';

import { useState } from 'react';
import type { ConnectionCheck } from '@/application/connectors/connectors';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import type { ConnectorProvider } from '@/libs/commerce/connectors';

export type StatusCheckPhase = 'idle' | 'checking' | 'connected' | 'attention' | 'waiting';

export type StatusCheckRequest = {
  /** The connection to check; without it the newest connection of `provider` is used. */
  connectionId?: string | null;
  provider?: ConnectorProvider | null;
  /** How many times to look before reporting that the store has not confirmed yet. */
  attempts?: number;
  delayMs?: number;
};

const DEFAULT_ATTEMPTS = 4;
const DEFAULT_DELAY_MS = 2_000;

function wait(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The status check after the seller comes back from the store: it looks for the
 * connection, and when it is connected does a test read of the catalog. A
 * WooCommerce approval reaches the service from the store's own server, so the
 * check looks a few times before saying it is still waiting.
 */
export function useConnectionStatusCheck() {
  const [phase, setPhase] = useState<StatusCheckPhase>('idle');
  const [result, setResult] = useState<ConnectionCheck | null>(null);

  const run = async (request: StatusCheckRequest = {}): Promise<StatusCheckPhase> => {
    const attempts = Math.max(1, request.attempts ?? DEFAULT_ATTEMPTS);
    const delayMs = request.delayMs ?? DEFAULT_DELAY_MS;
    setPhase('checking');
    let connectionId = request.connectionId ?? null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        if (!connectionId && request.provider) {
          const listed = await ConnectorsController.fetchConnections();
          const match = listed
            .filter((entry) => entry.provider === request.provider)
            .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0];
          connectionId = match?.id ?? null;
        }
        if (connectionId) {
          const check = await ConnectorsController.fetchConnectionCheck(connectionId);
          setResult(check);
          const status = check.connection?.status;
          if (status === 'connected' || status === 'needs_attention' || status === 'error') {
            const next: StatusCheckPhase =
              status === 'connected' && check.health?.state === 'connected' && check.catalogReadable
                ? 'connected'
                : 'attention';
            setPhase(next);
            return next;
          }
        }
      } catch {
        setResult(null);
      }
      if (attempt < attempts) await wait(delayMs);
    }
    setPhase('waiting');
    return 'waiting';
  };

  const reset = () => {
    setPhase('idle');
    setResult(null);
  };

  return { phase, result, run, reset };
}
