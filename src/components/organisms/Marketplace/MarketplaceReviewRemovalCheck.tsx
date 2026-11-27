'use client';

import { useState } from 'react';
import { Button } from '@/atoms/Button/Button';
import { Link } from '@/atoms/Link/Link';
import { CommerceController } from '@/controllers/commerce/commerce';

type RemovalCheck = Awaited<ReturnType<typeof CommerceController.fetchReviewRemovalCopy>>;

export function MarketplaceReviewRemovalCheck({
  orderId,
  listingId,
  pendingRemoval,
}: {
  orderId: string;
  listingId: string;
  pendingRemoval: boolean;
}) {
  const [check, setCheck] = useState<RemovalCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [withdrawalFailed, setWithdrawalFailed] = useState(false);

  const inspect = async (withdraw: boolean) => {
    setBusy(true);
    setWithdrawalFailed(false);
    try {
      if (withdraw && check?.kind === 'checked') {
        setWithdrawalFailed(
          !(await CommerceController.confirmReviewWithdrawal(orderId, listingId, check.reviewUpdatedAt)),
        );
      }
      setCheck(await CommerceController.fetchReviewRemovalCopy(orderId, listingId));
    } catch {
      setCheck({ kind: 'unknown' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1 grid justify-items-start gap-1">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void inspect(false)}>
        Check public copy
      </Button>
      {check?.kind === 'changed' && (
        <p>A different version is public now. Your earlier removal does not apply to it.</p>
      )}
      {check?.kind === 'unknown' && <p>Could not check the public copy. Try again.</p>}
      {check?.kind === 'checked' && (
        <>
          {check.copy === null ? (
            <p>No public copy of this review was found.</p>
          ) : (
            <div className="grid gap-1 break-all">
              <p>This review is still on your homeserver.</p>
              <blockquote>{check.copy.text}</blockquote>
              <p>
                To remove it, pause edits on your other devices and open this file in your homeserver file manager.
                Check the review text and purchase attestation before deleting it.
              </p>
              <code>{check.copy.uri}</code>
              <details>
                <summary>Purchase attestation</summary>
                <code>{check.copy.attestation}</code>
              </details>
              <Link href="https://github.com/pubky/pubky-drive#readme">Pubky Drive instructions</Link>
            </div>
          )}
          {withdrawalFailed && <p>The marketplace could not confirm this version’s withdrawal.</p>}
          {pendingRemoval && !check.withdrawn && (
            <Button size="sm" variant="destructive-soft" disabled={busy} onClick={() => void inspect(true)}>
              Withdraw this version from the marketplace
            </Button>
          )}
        </>
      )}
    </div>
  );
}
