'use client';

import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import type { SellerDeliveryKeyStatus } from '@/application/commerce/delivery-keys';
import { Badge } from '@/atoms/Badge/Badge';
import { Button } from '@/atoms/Button/Button';
import { Card, CardContent } from '@/atoms/Card/Card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/atoms/Dialog/Dialog';
import { Typography } from '@/atoms/Typography/Typography';
import { formatDeliveryKeyFingerprint } from '@/libs/commerce/delivery-envelope';

export type DeliveryPrivacyCardProps = {
  status: SellerDeliveryKeyStatus | null;
  isWorking: boolean;
  loadFailed: boolean;
  onCreate: () => Promise<boolean>;
  onPublish: () => Promise<boolean>;
};

const CUSTODY_COPY =
  'The key is created in this browser and its private half stays on this device. Buyers encrypt their delivery ' +
  'address to it, and only this device can open it: the marketplace service never can. If you lose this device or ' +
  "clear this browser's site data, addresses already sent to you cannot be opened, and you would ask the buyer to " +
  'send it again.';

/** Get Paid, Delivery privacy: create, publish and rotate the seller's delivery key. */
export function DeliveryPrivacyCard({ status, isWorking, loadFailed, onCreate, onPublish }: DeliveryPrivacyCardProps) {
  const [confirming, setConfirming] = useState(false);
  const local = status?.local ?? null;
  const published = status?.publication === 'matches';
  const rotating = local !== null;

  const confirm = async () => {
    const created = await onCreate();
    if (created) setConfirming(false);
  };

  return (
    <Card className="rounded-md p-0 shadow-lg">
      <CardContent className="grid gap-4 p-6">
        <div>
          <div className="flex items-center gap-2">
            <Typography as="h2" className="text-xl font-semibold">
              Delivery privacy
            </Typography>
            {published && <Badge variant="secondary">Published</Badge>}
            {local && !published && <Badge variant="secondary">Not published</Badge>}
          </div>
          <Typography as="p" className="mt-1 text-sm text-muted-foreground">
            Buyers encrypt their delivery address to your delivery key, so the marketplace service stores only
            ciphertext. Without a published key, buyers cannot check out shipped items from you.
          </Typography>
        </div>

        {loadFailed && (
          <Typography as="p" role="alert" className="text-sm text-destructive">
            Could not read your delivery key status. Check your connection and reload.
          </Typography>
        )}

        {local ? (
          <div className="grid gap-1 text-sm">
            <Typography as="p" className="font-medium">
              Key fingerprint
            </Typography>
            <Typography as="p" className="font-mono break-all" data-testid="delivery-key-fingerprint">
              {formatDeliveryKeyFingerprint(local.keyId)}
            </Typography>
            <Typography as="p" className="text-muted-foreground">
              Created {new Date(local.createdAt).toLocaleDateString()} on this device.
            </Typography>
            {status?.publication === 'different' && (
              <Typography as="p" className="text-muted-foreground">
                Your homeserver publishes a different key. Publish this one so buyers use it.
              </Typography>
            )}
          </div>
        ) : status?.publication === 'different' ? (
          <Typography as="p" className="text-sm text-muted-foreground">
            A delivery key is published for your pubky, but this device does not hold it. Orders sealed to it cannot be
            opened here. Creating a new key replaces the published one for new orders.
          </Typography>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {local && !published && (
            <Button className="rounded-full" disabled={isWorking} onClick={() => void onPublish()}>
              Publish key
            </Button>
          )}
          <Button
            className="rounded-full"
            variant={local && !published ? 'secondary' : 'default'}
            disabled={isWorking || status === null}
            onClick={() => setConfirming(true)}
          >
            <KeyRound className="size-4" />
            {rotating ? 'Rotate key' : 'Create delivery key'}
          </Button>
        </div>
      </CardContent>

      <Dialog open={confirming} onOpenChange={(open) => !isWorking && setConfirming(open)}>
        <DialogContent hiddenTitle={rotating ? 'Rotate delivery key' : 'Create delivery key'}>
          <DialogHeader>
            <DialogTitle>{rotating ? 'Rotate your delivery key?' : 'Create your delivery key?'}</DialogTitle>
            <DialogDescription>{CUSTODY_COPY}</DialogDescription>
          </DialogHeader>
          {rotating && (
            <Typography as="p" className="text-sm text-muted-foreground">
              New orders use the new key. This device keeps your earlier keys so earlier orders still open.
            </Typography>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={isWorking} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button disabled={isWorking} onClick={() => void confirm()}>
              {rotating ? 'Rotate key' : 'Create key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
