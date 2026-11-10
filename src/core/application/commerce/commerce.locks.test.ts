import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as commerceConfig from '@/config/commerce';
import type { CommerceDigitalLock } from '@/libs/commerce/marketplace-records';
import type { MarketplaceCommandResponse } from '@/libs/commerce/transaction-commands';
import type { CommerceLocksCorrelationModelSchema } from '@/models/commerce/commerce.schema';
import { LocalCommerceService } from '@/services/local/commerce/commerce';
import { LOCKS_PREPARED_TERMS_DIFFER_COPY, locksSubmitRefusalMessage } from '@/libs/commerce/locks-submit-refusal';
import { LocksGatewayService, type LocksVerificationLifecycle } from '@/services/locks/locks';
import { MarketplaceGatewayService } from '@/services/marketplace/marketplace';
import { createOrderFixture, ORDER_FIXTURE_BUYER, ORDER_FIXTURE_SELLER } from '@/test/fixtures/commerce/orders';
import { asOpaque } from '@/test-utils/type-assertions';
import { preparedLockResourceHash } from '@/libs/commerce/locks-payment';
import { CommerceApplication } from './commerce';

/**
 * pubky/locks#72: a payment submit is durable on the Lock Server before any
 * Paykit I/O, and the buyer polls that task instead of resubmitting. The Shop
 * therefore stores the bundle id before it submits, and an unregistered retry
 * looks the task up: a found task is never submitted again, and a missing one
 * is submitted with the same bundle id, never a fresh one.
 */

const BUNDLE_ID = '000G40R40M30E209185GR38E1W';
const CLIENT_REFERENCE = 'x9Kq_3-jW0sN8uYv1tB6rZpLmE4cA2dHfG7iOoQwXyU';
const SECOND_BUNDLE_ID = '000G40R40M30E209185GR38E1X';
const POLICY_URI = `pubky://${ORDER_FIXTURE_SELLER}/pub/locks.app/${'0'.repeat(52)}.json`;
const digitalLock = asOpaque<CommerceDigitalLock>({
  policyUri: POLICY_URI,
  criterionId: 'paykit',
  contentPath: 'pub/locks.app/content/file.bin',
  resourceHash: 'a'.repeat(64),
});

/** A pending task as a Lock Server from v0.1.1-rc2 returns it for a bundle submitted with `clientReference`. */
function pendingLifecycle(
  statusMessage: string | null = null,
  clientReference: string | null = CLIENT_REFERENCE,
): LocksVerificationLifecycle {
  return {
    creator: `pubky${ORDER_FIXTURE_SELLER}`,
    bundle_id: BUNDLE_ID,
    status: 'pending',
    submitted_at: '2026-10-06T18:00:00.000Z',
    started_at: null,
    completed_at: null,
    failure_message: null,
    status_message: statusMessage,
    ...(clientReference
      ? {
          client_binding: {
            client_reference: clientReference,
            pubky_lock_resource: `pubky${ORDER_FIXTURE_SELLER}/pub/locks.app/${'0'.repeat(52)}.json`,
            criterion_ids: ['paykit'],
          },
        }
      : {}),
  };
}

/** The lock the checkout snapshotted (A); `digitalLock` above is what the listing shows when it matches. */
const PREPARED_TERMS = { lockResourceHash: preparedLockResourceHash(POLICY_URI)!, criterionId: 'paykit' };

/** The service's answers: a preparation returns the buyer's reference and terms, a registration the open window. */
function serviceAnswer(kind: string, terms = PREPARED_TERMS): MarketplaceCommandResponse {
  return kind === 'payment.prepare_locks'
    ? asOpaque<MarketplaceCommandResponse>({
        ok: true,
        revision: 4,
        result: { kind: 'payment', clientReference: CLIENT_REFERENCE, ...terms },
      })
    : asOpaque<MarketplaceCommandResponse>({
        ok: true,
        revision: 5,
        result: { kind: 'payment', verification: { windowExpiresAt: '2026-10-06T19:00:00.000Z' } },
      });
}

describe('CommerceApplication Locks payment start (pubky/locks#72 no-resubmit rule)', () => {
  const store = new Map<string, CommerceLocksCorrelationModelSchema>();
  const order = createOrderFixture('pending_payment');
  const payment = asOpaque<Parameters<typeof CommerceApplication.beginMarketplaceLocksPayment>[0]['payment']>({
    id: 'payment-1',
    revision: 3,
  });
  const begin = () =>
    CommerceApplication.beginMarketplaceLocksPayment({ buyerPubky: ORDER_FIXTURE_BUYER, order, payment, digitalLock });

  beforeEach(() => {
    store.clear();
    vi.spyOn(commerceConfig, 'getCommerceAdapterMode').mockReturnValue('locks-paykit');
    vi.spyOn(LocalCommerceService, 'getLocksCorrelation').mockImplementation(async (_owner, paymentId) =>
      asOpaque(store.get(paymentId) ?? null),
    );
    vi.spyOn(LocalCommerceService, 'upsertLocksCorrelation').mockImplementation(async (correlation) => {
      store.set(correlation.payment_id, { ...correlation, id: correlation.payment_id });
    });
    vi.spyOn(LocalCommerceService, 'markLocksCorrelationRegistered').mockImplementation(
      async (_owner, paymentId, windowExpiresAt) => {
        const current = store.get(paymentId)!;
        store.set(paymentId, { ...current, registered: true, window_expires_at: windowExpiresAt });
      },
    );
    vi.spyOn(LocksGatewayService, 'generateBundleId')
      .mockResolvedValueOnce(BUNDLE_ID)
      .mockResolvedValueOnce(SECOND_BUNDLE_ID);
    vi.spyOn(MarketplaceGatewayService, 'execute').mockImplementation(async (_actor, command) =>
      serviceAnswer(command.kind),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores the bundle id before the submit, submits once and registers it', async () => {
    const order_: string[] = [];
    vi.mocked(LocalCommerceService.upsertLocksCorrelation).mockImplementation(async (correlation) => {
      order_.push('store');
      store.set(correlation.payment_id, { ...correlation, id: correlation.payment_id });
    });
    const submit = vi.spyOn(LocksGatewayService, 'submitPaykitProof').mockImplementation(async () => {
      order_.push('submit');
      return pendingLifecycle();
    });
    const find = vi.spyOn(LocksGatewayService, 'findVerification');

    await expect(begin()).resolves.toMatchObject({ ok: true });

    expect(order_).toEqual(['store', 'submit']);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ bundleId: BUNDLE_ID, clientReference: CLIENT_REFERENCE }),
    );
    expect(find).not.toHaveBeenCalled();
    expect(store.get('payment-1')).toMatchObject({ bundle_id: BUNDLE_ID, registered: true });
    expect(MarketplaceGatewayService.execute).toHaveBeenCalledWith(
      ORDER_FIXTURE_BUYER,
      expect.objectContaining({
        kind: 'payment.register_locks',
        payload: expect.objectContaining({ bundleId: BUNDLE_ID }),
      }),
    );
  });

  it('after a submit whose answer was lost, a retry finds the durable task and never submits it again', async () => {
    const submit = vi
      .spyOn(LocksGatewayService, 'submitPaykitProof')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const find = vi.spyOn(LocksGatewayService, 'findVerification').mockResolvedValue(pendingLifecycle());

    await expect(begin()).rejects.toThrow('Failed to fetch');
    expect(store.get('payment-1')).toMatchObject({ bundle_id: BUNDLE_ID, registered: false });

    await expect(begin()).resolves.toMatchObject({ ok: true });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith(ORDER_FIXTURE_SELLER, BUNDLE_ID);
    expect(LocksGatewayService.generateBundleId).toHaveBeenCalledTimes(1);
    expect(MarketplaceGatewayService.execute).toHaveBeenCalledWith(
      ORDER_FIXTURE_BUYER,
      expect.objectContaining({ payload: expect.objectContaining({ bundleId: BUNDLE_ID }) }),
    );
  });

  it('a retry for a submit the Lock Server refused submits the same bundle id, never a fresh one', async () => {
    const submit = vi
      .spyOn(LocksGatewayService, 'submitPaykitProof')
      .mockRejectedValueOnce(new Error('422 reader_pubky_unresolvable'))
      .mockResolvedValueOnce(pendingLifecycle());
    vi.spyOn(LocksGatewayService, 'findVerification').mockResolvedValue(null);

    await expect(begin()).rejects.toThrow('422');
    await expect(begin()).resolves.toMatchObject({ ok: true });

    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls.map(([params]) => params.bundleId)).toEqual([BUNDLE_ID, BUNDLE_ID]);
    expect(submit.mock.calls.map(([params]) => params.clientReference)).toEqual([CLIENT_REFERENCE, CLIENT_REFERENCE]);
    expect(LocksGatewayService.generateBundleId).toHaveBeenCalledTimes(1);
  });

  it('prepares the payment, then submits the bundle, then registers only the payment and bundle ids', async () => {
    const steps: string[] = [];
    vi.mocked(MarketplaceGatewayService.execute).mockImplementation(async (_actor, command) => {
      steps.push(command.kind);
      return serviceAnswer(command.kind);
    });
    vi.spyOn(LocksGatewayService, 'submitPaykitProof').mockImplementation(async () => {
      steps.push('submit');
      return pendingLifecycle();
    });

    await expect(begin()).resolves.toMatchObject({ ok: true });

    expect(steps).toEqual(['payment.prepare_locks', 'submit', 'payment.register_locks']);
    const [prepare, register] = vi.mocked(MarketplaceGatewayService.execute).mock.calls.map(([, command]) => command);
    expect(prepare).toMatchObject({ expectedRevision: 3, payload: { paymentId: 'payment-1' } });
    expect(register).toMatchObject({ expectedRevision: 4 });
    expect(register.payload).toEqual({ paymentId: 'payment-1', bundleId: BUNDLE_ID });
  });

  it('submits nothing, and stores no bundle, when the preparation returns no usable reference', async () => {
    const submit = vi.spyOn(LocksGatewayService, 'submitPaykitProof');
    for (const result of [{ kind: 'payment' }, { kind: 'payment', clientReference: '' }, { clientReference: 42 }]) {
      vi.mocked(MarketplaceGatewayService.execute).mockResolvedValueOnce(asOpaque({ ok: true, revision: 4, result }));
      await expect(begin()).rejects.toMatchObject({ name: 'AppError', code: 'INVALID_RESPONSE' });
    }

    expect(submit).not.toHaveBeenCalled();
    expect(LocksGatewayService.generateBundleId).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
    expect(MarketplaceGatewayService.execute).toHaveBeenCalledTimes(3);
  });

  it('stops before registering when the Lock Server does not echo the reference, and never sends a second bundle', async () => {
    const submit = vi
      .spyOn(LocksGatewayService, 'submitPaykitProof')
      .mockRejectedValueOnce(
        Object.assign(new Error('The Lock Server did not bind the payment reference.'), { code: 'INVALID_RESPONSE' }),
      );
    vi.spyOn(LocksGatewayService, 'findVerification').mockResolvedValue(pendingLifecycle(null, null));

    await expect(begin()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(MarketplaceGatewayService.execute).mock.calls.map(([, command]) => command.kind),
      'the payment is never registered',
    ).toEqual(['payment.prepare_locks']);

    // The task the Lock Server stored carries no reference and cannot be rewritten:
    // the retry finds it, refuses it, and still registers nothing and submits nothing.
    await expect(begin()).rejects.toMatchObject({ name: 'AppError', code: 'INVALID_RESPONSE' });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(MarketplaceGatewayService.execute).mock.calls.map(([, command]) => command.kind)).toEqual([
      'payment.prepare_locks',
      'payment.prepare_locks',
    ]);
    expect(store.get('payment-1')).toMatchObject({ registered: false });
  });

  it('refuses a stored task bound to another payment reference', async () => {
    vi.spyOn(LocksGatewayService, 'submitPaykitProof').mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.spyOn(LocksGatewayService, 'findVerification').mockResolvedValue(
      pendingLifecycle(null, 'a-reference-minted-for-another-payment'),
    );

    await expect(begin()).rejects.toThrow('Failed to fetch');
    await expect(begin()).rejects.toMatchObject({ name: 'AppError', code: 'INVALID_RESPONSE' });
    expect(
      vi
        .mocked(MarketplaceGatewayService.execute)
        .mock.calls.filter(([, command]) => command.kind === 'payment.register_locks'),
    ).toHaveLength(0);
  });

  describe('checkout snapshot A and a listing the seller moved to lock B', () => {
    const lockB = asOpaque<CommerceDigitalLock>({
      ...digitalLock,
      policyUri: `pubky://${ORDER_FIXTURE_SELLER}/pub/locks.app/${'0'.repeat(51)}1.json`,
    });
    const beginWith = (lock: CommerceDigitalLock) =>
      CommerceApplication.beginMarketplaceLocksPayment({
        buyerPubky: ORDER_FIXTURE_BUYER,
        order,
        payment,
        digitalLock: lock,
      });
    const kinds = () => vi.mocked(MarketplaceGatewayService.execute).mock.calls.map(([, command]) => command.kind);

    it('refuses before any payable task exists when the listing now shows lock B', async () => {
      const submit = vi.spyOn(LocksGatewayService, 'submitPaykitProof');
      const find = vi.spyOn(LocksGatewayService, 'findVerification');

      const error = await beginWith(lockB).catch((caught: unknown) => caught);

      expect(error).toMatchObject({ name: 'AppError', context: { preparedTermsDiffer: true } });
      expect(locksSubmitRefusalMessage(error, 'fallback')).toBe(LOCKS_PREPARED_TERMS_DIFFER_COPY);
      expect(submit).not.toHaveBeenCalled();
      expect(find).not.toHaveBeenCalled();
      expect(LocksGatewayService.generateBundleId).not.toHaveBeenCalled();
      expect(store.size).toBe(0);
      expect(kinds()).toEqual(['payment.prepare_locks']);
    });

    it('refuses a listing whose criterion moved even when the lock resource did not', async () => {
      const submit = vi.spyOn(LocksGatewayService, 'submitPaykitProof');

      await expect(
        beginWith(asOpaque<CommerceDigitalLock>({ ...digitalLock, criterionId: 'other' })),
      ).rejects.toMatchObject({ context: { preparedTermsDiffer: true } });

      expect(submit).not.toHaveBeenCalled();
      expect(kinds()).toEqual(['payment.prepare_locks']);
    });

    it('refuses the retry of an unregistered order after the seller moved to lock B, and registers nothing', async () => {
      vi.spyOn(LocksGatewayService, 'submitPaykitProof').mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const find = vi.spyOn(LocksGatewayService, 'findVerification').mockResolvedValue(pendingLifecycle());
      await expect(beginWith(digitalLock)).rejects.toThrow('Failed to fetch');
      expect(store.get('payment-1')).toMatchObject({ registered: false });

      await expect(beginWith(lockB)).rejects.toMatchObject({ context: { preparedTermsDiffer: true } });

      expect(find).not.toHaveBeenCalled();
      expect(LocksGatewayService.submitPaykitProof).toHaveBeenCalledTimes(1);
      expect(kinds()).not.toContain('payment.register_locks');
    });

    it('submits for the lock the payment was prepared against, spelled in lowercase by the listing', async () => {
      const canonical = POLICY_URI.replace('0'.repeat(52), 'A'.repeat(52));
      vi.mocked(MarketplaceGatewayService.execute).mockImplementationOnce(async (_actor, command) =>
        serviceAnswer(command.kind, { lockResourceHash: preparedLockResourceHash(canonical)!, criterionId: 'paykit' }),
      );
      const submit = vi.spyOn(LocksGatewayService, 'submitPaykitProof').mockResolvedValue(pendingLifecycle());
      const lowercase = asOpaque<CommerceDigitalLock>({
        ...digitalLock,
        policyUri: POLICY_URI.replace('0'.repeat(52), 'a'.repeat(52)),
      });

      await expect(beginWith(lowercase)).resolves.toMatchObject({ ok: true });

      expect(submit).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['no terms', {}],
      ['a hash that is not BLAKE3 hex', { lockResourceHash: 'abc', criterionId: 'paykit' }],
      ['an empty criterion', { lockResourceHash: PREPARED_TERMS.lockResourceHash, criterionId: '' }],
    ])('submits nothing when the preparation returns %s', async (_label, terms) => {
      vi.mocked(MarketplaceGatewayService.execute).mockResolvedValueOnce(
        asOpaque({ ok: true, revision: 4, result: { kind: 'payment', clientReference: CLIENT_REFERENCE, ...terms } }),
      );
      const submit = vi.spyOn(LocksGatewayService, 'submitPaykitProof');

      await expect(beginWith(digitalLock)).rejects.toMatchObject({ name: 'AppError', code: 'INVALID_RESPONSE' });

      expect(submit).not.toHaveBeenCalled();
      expect(store.size).toBe(0);
    });
  });

  it('registers a bundle submitted before any preparation by preparing first, without a new submit', async () => {
    store.set('payment-1', {
      id: 'payment-1',
      owner_id: ORDER_FIXTURE_BUYER,
      payment_id: 'payment-1',
      order_id: order.id,
      seller_pubky: ORDER_FIXTURE_SELLER,
      bundle_id: BUNDLE_ID,
      policy_uri: POLICY_URI,
      criterion_id: 'paykit',
      content_path: digitalLock.contentPath,
      resource_hash: digitalLock.resourceHash,
      window_expires_at: null,
      registered: false,
      created_at: 1,
      updated_at: 1,
    });
    const submit = vi.spyOn(LocksGatewayService, 'submitPaykitProof');
    vi.spyOn(LocksGatewayService, 'findVerification').mockResolvedValue(pendingLifecycle());

    await expect(begin()).resolves.toMatchObject({ ok: true });

    expect(submit).not.toHaveBeenCalled();
    expect(vi.mocked(MarketplaceGatewayService.execute).mock.calls.map(([, command]) => command.kind)).toEqual([
      'payment.prepare_locks',
      'payment.register_locks',
    ]);
    expect(store.get('payment-1')).toMatchObject({ bundle_id: BUNDLE_ID, registered: true });
  });

  it('submits nothing to the Lock Server when the service refuses the preparation', async () => {
    vi.mocked(MarketplaceGatewayService.execute).mockResolvedValueOnce(
      asOpaque({ ok: false, error: { code: 'INVALID_STATE', message: 'refused' } }),
    );
    const submit = vi.spyOn(LocksGatewayService, 'submitPaykitProof');

    await expect(begin()).resolves.toMatchObject({ ok: false });

    expect(submit).not.toHaveBeenCalled();
    expect(LocksGatewayService.generateBundleId).not.toHaveBeenCalled();
    expect(MarketplaceGatewayService.execute).toHaveBeenCalledTimes(1);
  });

  it('a registered correlation is neither looked up nor submitted again', async () => {
    const submit = vi.spyOn(LocksGatewayService, 'submitPaykitProof').mockResolvedValue(pendingLifecycle());
    const find = vi.spyOn(LocksGatewayService, 'findVerification');

    await begin();
    await begin();

    expect(submit).toHaveBeenCalledTimes(1);
    expect(find).not.toHaveBeenCalled();
  });

  it('reads the admission state of the stored task for the buyer', async () => {
    vi.spyOn(LocksGatewayService, 'submitPaykitProof').mockResolvedValue(pendingLifecycle());
    const find = vi
      .spyOn(LocksGatewayService, 'findVerification')
      .mockResolvedValueOnce(pendingLifecycle('Reader wallet setup needed'))
      .mockResolvedValueOnce({
        ...pendingLifecycle(),
        status: 'failed',
        started_at: '2026-10-06T18:10:00.000Z',
        completed_at: '2026-10-06T18:10:00.000Z',
        failure_message: 'invoice admission deadline exceeded',
      })
      .mockResolvedValueOnce(null);
    await expect(
      CommerceApplication.fetchMarketplaceLocksAdmission(ORDER_FIXTURE_BUYER, 'payment-1'),
    ).resolves.toBeNull();
    await begin();

    await expect(CommerceApplication.fetchMarketplaceLocksAdmission(ORDER_FIXTURE_BUYER, 'payment-1')).resolves.toEqual(
      {
        kind: 'in_flight',
        readerWalletSetupNeeded: true,
        stalled: false,
      },
    );
    await expect(CommerceApplication.fetchMarketplaceLocksAdmission(ORDER_FIXTURE_BUYER, 'payment-1')).resolves.toEqual(
      {
        kind: 'failed',
        failure: 'admission_deadline_exceeded',
      },
    );
    await expect(
      CommerceApplication.fetchMarketplaceLocksAdmission(ORDER_FIXTURE_BUYER, 'payment-1'),
    ).resolves.toBeNull();
    expect(find).toHaveBeenCalledTimes(3);
    expect(LocksGatewayService.submitPaykitProof).toHaveBeenCalledTimes(1);
  });

  it('reads a pending task past its admission deadline as stalled, and an expired one by its terminal reason', async () => {
    vi.spyOn(LocksGatewayService, 'submitPaykitProof').mockResolvedValue(pendingLifecycle());
    vi.spyOn(LocksGatewayService, 'findVerification')
      .mockResolvedValueOnce({
        ...pendingLifecycle(),
        admission_deadline_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      })
      .mockResolvedValueOnce({
        ...pendingLifecycle(),
        admission_deadline_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      })
      .mockResolvedValueOnce({
        ...pendingLifecycle(),
        status: 'expired',
        failure_message: null,
        terminal_reason: 'payment_request_rejected',
      });
    await begin();

    await expect(CommerceApplication.fetchMarketplaceLocksAdmission(ORDER_FIXTURE_BUYER, 'payment-1')).resolves.toEqual(
      {
        kind: 'in_flight',
        readerWalletSetupNeeded: false,
        stalled: true,
      },
    );
    await expect(CommerceApplication.fetchMarketplaceLocksAdmission(ORDER_FIXTURE_BUYER, 'payment-1')).resolves.toEqual(
      {
        kind: 'in_flight',
        readerWalletSetupNeeded: false,
        stalled: false,
      },
    );
    await expect(CommerceApplication.fetchMarketplaceLocksAdmission(ORDER_FIXTURE_BUYER, 'payment-1')).resolves.toEqual(
      {
        kind: 'expired',
        reason: 'payment_request_rejected',
      },
    );
  });
});
