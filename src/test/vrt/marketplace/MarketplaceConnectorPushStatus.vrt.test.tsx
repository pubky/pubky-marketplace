// Intentional import order — browser-mode mock factories rely on stable aliases.
/* eslint-disable simple-import-sort/imports */
import { describe, expect, it, vi } from 'vitest';
import { expectVrtSurface, renderForVRT } from '@/test-utils/vrt';
import { VRT_VIEWPORT_DESKTOP, VRT_VIEWPORT_MOBILE } from '@/test-utils/vrt.viewports';
import { MarketplaceConnectorPushStatus } from '@/organisms/Marketplace/MarketplaceConnectorPushStatus';
import {
  connectorAlertSchema,
  connectorConnectionSchema,
  connectorPushSchema,
  pushNeedsAction,
} from '@/libs/commerce/connectors';

const view = vi.hoisted(() => ({ pushes: [] as unknown[], alerts: [] as unknown[] }));

vi.mock('@/hooks/useConnectorPushStatus/useConnectorPushStatus', () => ({
  useConnectorPushStatus: () => ({
    visible: true,
    connections: [],
    pushes: view.pushes,
    needsAttention: (view.pushes as Array<{ push: Parameters<typeof pushNeedsAction>[0] }>).filter(({ push }) =>
      pushNeedsAction(push),
    ),
    alerts: view.alerts,
    retryingOrderId: null,
    retry: async () => true,
    dismissAlert: async () => true,
    refresh: async () => {},
  }),
}));

const connection = connectorConnectionSchema.parse({
  id: 'c1',
  provider: 'woocommerce',
  domain: 'dezentralshop.ch',
  status: 'connected',
  scopes: ['read_write'],
});

function push(id: string, overrides: Record<string, unknown>) {
  return {
    connection,
    push: connectorPushSchema.parse({
      id: `push-${id}`,
      pubkyOrderId: `0f3a9c1${id}-6d52-4b7e-9d3a-aaaaaaaaaaaa`,
      provider: 'woocommerce',
      state: 'created',
      externalId: `50${id}`,
      createdAt: '2026-10-15T12:00:00.000Z',
      updatedAt: `2026-10-15T12:0${id}:00.000Z`,
      ...overrides,
    }),
  };
}

describe('Order push status — visual regression', () => {
  it('renders sent orders, a stuck order with Retry and a store-side cancel at desktop viewport', async () => {
    view.pushes = [
      push('5', {
        state: 'quarantined',
        externalId: null,
        quarantineReason: 'unmapped_variant',
        quarantineSeverity: 'action_required',
      }),
      push('4', { state: 'sending', externalId: null }),
      push('3', {}),
      push('2', {}),
    ];
    view.alerts = [
      connectorAlertSchema.parse({
        id: 'a1',
        connectionId: 'c1',
        kind: 'merchant_cancelled',
        pubkyOrderId: '0f3a9c12-6d52-4b7e-9d3a-aaaaaaaaaaaa',
        createdAt: '2026-10-15T12:00:00.000Z',
      }),
    ];
    await renderForVRT(
      <main className="w-full py-6">
        <MarketplaceConnectorPushStatus />
      </main>,
      { viewport: VRT_VIEWPORT_DESKTOP, disableHover: true },
    );
    await expect(await expectVrtSurface('store-push-status')).toMatchScreenshot('push-status-desktop');
  });

  it('renders the same status at mobile viewport', async () => {
    await renderForVRT(
      <main className="w-full py-6">
        <MarketplaceConnectorPushStatus />
      </main>,
      { viewport: VRT_VIEWPORT_MOBILE, disableHover: true },
    );
    await expect(await expectVrtSurface('store-push-status')).toMatchScreenshot('push-status-mobile');
  });
});
