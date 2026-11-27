/** @vitest-environment node */
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFlow, pollFlow } from './bff';
import type { MarketplaceGrantConfig } from './config';
import {
  encodeBase64Url,
  hashBoundCookie,
  makeBoundCookie,
  parseBoundCookie,
  sealBearer,
  sealFlowContext,
} from './crypto';
import type { BridgeRow, FlowRow } from './db';
import { GrantServiceError } from './service';

const ORIGIN = 'https://shop.example';
const PUBKY = 'y'.repeat(52);
const BEARER = 'K'.repeat(43);
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const BRIDGE_ID = '33333333-3333-4333-8333-333333333333';
const STATE_ID = '44444444-4444-4444-8444-444444444444';
const FLOW_ID = '55555555-5555-4555-8555-555555555555';

const config: MarketplaceGrantConfig = vi.hoisted(() => ({
  allowedOrigins: ['https://shop.example'],
  publicOrigin: 'https://shop.example',
  serviceUrl: 'https://service.example',
  databaseUrl: 'postgres://example',
  cronSecret: 'c'.repeat(32),
  assertionIssuer: 'https://shop.example',
  assertionKeyId: 'shop-bff-test-0001',
  assertionKeyEpoch: 1,
  assertionSigningKey: '11'.repeat(32),
  requestKeyId: 'shop-bff-test-request-0001',
  requestKeyEpoch: 1,
  requestSigningKey: '22'.repeat(32),
  stateKey: Buffer.alloc(32, 3).toString('base64'),
  stateKeyEpoch: 1,
  stateTtlSeconds: 300,
  claimLeaseSeconds: 25,
  databaseTimeoutMs: 2000,
  serviceTimeoutMs: 5000,
}));

const dbMocks = vi.hoisted(() => ({
  getBridge: vi.fn(),
  touchBridge: vi.fn(),
  getFlow: vi.fn(),
  insertCreatingFlow: vi.fn(),
  bindFlow: vi.fn(),
  terminalizeFlow: vi.fn(),
  acquireClaim: vi.fn(),
  renewClaim: vi.fn(),
  completeClaim: vi.fn(),
  abandonClaim: vi.fn(),
}));

const serviceMocks = vi.hoisted(() => ({
  verifyMarketplaceSession: vi.fn(),
  createReconnectFlow: vi.fn(),
  getGrantStatus: vi.fn(),
  claimGrantResult: vi.fn(),
}));

vi.mock('./config', () => ({
  getMarketplaceGrantConfig: () => config,
}));

vi.mock('./db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./db')>()),
  getBridge: dbMocks.getBridge,
  touchBridge: dbMocks.touchBridge,
  getFlow: dbMocks.getFlow,
  insertCreatingFlow: dbMocks.insertCreatingFlow,
  bindFlow: dbMocks.bindFlow,
  terminalizeFlow: dbMocks.terminalizeFlow,
  acquireClaim: dbMocks.acquireClaim,
  renewClaim: dbMocks.renewClaim,
  completeClaim: dbMocks.completeClaim,
  abandonClaim: dbMocks.abandonClaim,
}));

vi.mock('./service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service')>()),
  verifyMarketplaceSession: serviceMocks.verifyMarketplaceSession,
  createReconnectFlow: serviceMocks.createReconnectFlow,
  getGrantStatus: serviceMocks.getGrantStatus,
  claimGrantResult: serviceMocks.claimGrantResult,
}));

function makeJsonPostRequest(path: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    },
    body: '{}',
  });
}

function makeBridgeAndFlow() {
  const sessionCookie = makeBoundCookie(BRIDGE_ID);
  const flowCookie = makeBoundCookie(STATE_ID);
  const parsedSession = parseBoundCookie(sessionCookie.value)!;
  const parsedFlow = parseBoundCookie(flowCookie.value)!;

  const bridge: BridgeRow = {
    bridge_id: BRIDGE_ID,
    cookie_hash: hashBoundCookie(config, config.stateKeyEpoch, 'session', BRIDGE_ID, parsedSession.secret),
    pubky: PUBKY,
    marketplace_session_id: SESSION_ID,
    bearer_sealed: sealBearer(config, BRIDGE_ID, SESSION_ID, PUBKY, BEARER),
    key_epoch: config.stateKeyEpoch,
    created_at: new Date(),
    expires_at: new Date(Date.now() + 3_600_000),
    last_verified_at: new Date(),
  };

  const contextSealed = sealFlowContext(config, STATE_ID, BRIDGE_ID, {
    resultDeliveryId: encodeBase64Url(randomBytes(32)),
    resultPopSeed: encodeBase64Url(randomBytes(32)),
    version: 1,
  });

  const flow: FlowRow = {
    state_id: STATE_ID,
    bridge_id: BRIDGE_ID,
    flow_id: FLOW_ID,
    result_binding_hash: hashBoundCookie(config, config.stateKeyEpoch, 'flow', STATE_ID, parsedFlow.secret),
    context_sealed: contextSealed,
    key_epoch: config.stateKeyEpoch,
    status: 'awaiting',
    lease_owner: null,
    lease_until: null,
    version: '1',
    created_at: new Date(),
    expires_at: new Date(Date.now() + 300_000),
    terminal_at: null,
  };

  return { sessionCookie: sessionCookie.value, flowCookie: flowCookie.value, bridge, flow };
}

describe('Grant BFF pollFlow session verification cadence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.touchBridge.mockResolvedValue(true);
    dbMocks.insertCreatingFlow.mockResolvedValue(undefined);
    dbMocks.bindFlow.mockResolvedValue(true);
    dbMocks.terminalizeFlow.mockResolvedValue(undefined);
    dbMocks.renewClaim.mockResolvedValue(true);
    dbMocks.completeClaim.mockResolvedValue(true);
    dbMocks.abandonClaim.mockResolvedValue(undefined);
    serviceMocks.verifyMarketplaceSession.mockResolvedValue(new Date(Date.now() + 3_600_000));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['awaiting', 'verifying'] as const)(
    'does not call verifyMarketplaceSession or touchBridge while a flow is %s',
    async (status) => {
      const { sessionCookie, flowCookie, bridge, flow } = makeBridgeAndFlow();
      dbMocks.getBridge.mockResolvedValue(bridge);
      dbMocks.getFlow.mockResolvedValue(flow);
      serviceMocks.getGrantStatus.mockResolvedValue({
        flow_id: FLOW_ID,
        status,
        expires_at: '2026-11-27T20:00:00.000Z',
      });

      const result = await pollFlow(
        makeJsonPostRequest(`/api/marketplace/grant-flows/${STATE_ID}/status`),
        sessionCookie,
        flowCookie,
        STATE_ID,
      );

      expect(result).toEqual({
        expires_at: '2026-11-27T20:00:00.000Z',
        state_id: STATE_ID,
        status,
      });
      expect(serviceMocks.getGrantStatus).toHaveBeenCalledTimes(1);
      expect(serviceMocks.verifyMarketplaceSession).not.toHaveBeenCalled();
      expect(dbMocks.touchBridge).not.toHaveBeenCalled();
    },
  );

  it('verifies the marketplace session and touches the bridge when the flow completes before claiming', async () => {
    const { sessionCookie, flowCookie, bridge, flow } = makeBridgeAndFlow();
    dbMocks.getBridge.mockResolvedValue(bridge);
    dbMocks.getFlow.mockResolvedValue(flow);
    dbMocks.acquireClaim.mockResolvedValue(flow);
    serviceMocks.getGrantStatus.mockResolvedValue({
      flow_id: FLOW_ID,
      status: 'complete',
      expires_at: '2026-11-27T20:00:00.000Z',
    });
    serviceMocks.claimGrantResult.mockResolvedValue({
      capabilities: '/pub/pubky.app/:rw',
      expires_at: '2026-11-28T20:00:00.000Z',
      pubky: PUBKY,
      token: 'T'.repeat(43),
    });

    const result = await pollFlow(
      makeJsonPostRequest(`/api/marketplace/grant-flows/${STATE_ID}/status`),
      sessionCookie,
      flowCookie,
      STATE_ID,
    );

    expect(result).toMatchObject({ pubky: PUBKY, status: 'connected' });
    expect(serviceMocks.verifyMarketplaceSession).toHaveBeenCalledTimes(1);
    expect(serviceMocks.verifyMarketplaceSession).toHaveBeenCalledWith(config, BEARER, PUBKY, SESSION_ID);
    expect(dbMocks.touchBridge).toHaveBeenCalledTimes(1);
    expect(dbMocks.touchBridge).toHaveBeenCalledWith(config, BRIDGE_ID);
    expect(serviceMocks.verifyMarketplaceSession.mock.invocationCallOrder[0]).toBeLessThan(
      dbMocks.acquireClaim.mock.invocationCallOrder[0],
    );
  });

  it('refuses to claim when upstream session verification fails on flow completion', async () => {
    const { sessionCookie, flowCookie, bridge, flow } = makeBridgeAndFlow();
    dbMocks.getBridge.mockResolvedValue(bridge);
    dbMocks.getFlow.mockResolvedValue(flow);
    serviceMocks.getGrantStatus.mockResolvedValue({
      flow_id: FLOW_ID,
      status: 'complete',
      expires_at: '2026-11-27T20:00:00.000Z',
    });
    serviceMocks.verifyMarketplaceSession.mockRejectedValueOnce(new GrantServiceError(401, 'invalid_session_pair'));

    await expect(
      pollFlow(
        makeJsonPostRequest(`/api/marketplace/grant-flows/${STATE_ID}/status`),
        sessionCookie,
        flowCookie,
        STATE_ID,
      ),
    ).rejects.toMatchObject({ status: 401, code: 'invalid_session_pair' });

    expect(dbMocks.acquireClaim).not.toHaveBeenCalled();
    expect(serviceMocks.claimGrantResult).not.toHaveBeenCalled();
    expect(dbMocks.touchBridge).not.toHaveBeenCalled();
  });

  it('rejects a forged session cookie on pending pollFlow before querying grant status', async () => {
    const { flowCookie, bridge, flow } = makeBridgeAndFlow();
    dbMocks.getBridge.mockResolvedValue(bridge);
    dbMocks.getFlow.mockResolvedValue(flow);

    await expect(
      pollFlow(
        makeJsonPostRequest(`/api/marketplace/grant-flows/${STATE_ID}/status`),
        makeBoundCookie(BRIDGE_ID).value,
        flowCookie,
        STATE_ID,
      ),
    ).rejects.toMatchObject({ status: 403, code: 'shop_session_denied' });

    expect(serviceMocks.getGrantStatus).not.toHaveBeenCalled();
    expect(serviceMocks.verifyMarketplaceSession).not.toHaveBeenCalled();
  });

  it('still validates the existing marketplace session at createFlow start', async () => {
    const { sessionCookie, bridge } = makeBridgeAndFlow();
    dbMocks.getBridge.mockResolvedValue(bridge);
    serviceMocks.createReconnectFlow.mockResolvedValue({
      authorization_url: 'pubkyauth://signin_grant?x=1',
      expires_at: '2026-11-27T20:00:00.000Z',
      flow_id: FLOW_ID,
      status: 'awaiting',
    });

    const created = await createFlow(makeJsonPostRequest('/api/marketplace/grant-flows'), sessionCookie);

    expect(created.response.status).toBe('awaiting');
    expect(serviceMocks.verifyMarketplaceSession).toHaveBeenCalledTimes(1);
    expect(dbMocks.touchBridge).toHaveBeenCalledTimes(1);
  });
});
