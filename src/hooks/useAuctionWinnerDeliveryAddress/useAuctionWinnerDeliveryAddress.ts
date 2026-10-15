'use client';

import { useEffect, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLiveQuery } from 'dexie-react-hooks';
import { useForm, type UseFormReturn, useWatch } from 'react-hook-form';
import { CommerceController } from '@/controllers/commerce/commerce';
import {
  type DeliveryKeyBlock,
  type PendingDeliveryKeyChange,
  useDeliveryKeyGate,
} from '@/hooks/useDeliveryKeyGate/useDeliveryKeyGate';
import { checkDestinationCountry } from '@/hooks/useMarketplaceSellerShipsTo/useMarketplaceSellerShipsTo';
import type { BindDeliveryAddress } from '@/libs/commerce/payment-methods';
import { browserAddressCountry, commerceDeliveryAddressValueSchema } from '@/libs/commerce/postal-address';
import type { CommerceDeliveryAddressModelSchema } from '@/models/commerce/commerce.schema';
import { useAuthStore } from '@/stores/auth/auth.store';
import {
  AUCTION_WINNER_ADDRESS_FIELDS,
  type AuctionWinnerAddressData,
  auctionWinnerAddressDefaults,
  auctionWinnerAddressSchema,
} from './useAuctionWinnerDeliveryAddress.types';

export type AuctionWinnerDeliveryResult = { ok: true; delivery: BindDeliveryAddress } | { ok: false };

function bareAddressId(address: CommerceDeliveryAddressModelSchema): string {
  return address.id.slice(address.owner_id.length + 1);
}

function savedAddressValues(address: CommerceDeliveryAddressModelSchema): AuctionWinnerAddressData {
  return {
    name: address.name,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    region: address.region,
    postalCode: address.postal_code,
    countryCode: address.country_code,
  };
}

function matchesSaved(data: AuctionWinnerAddressData, address: CommerceDeliveryAddressModelSchema): boolean {
  const saved = savedAddressValues(address);
  return AUCTION_WINNER_ADDRESS_FIELDS.every((field) => {
    const entered = field === 'countryCode' ? data[field].trim().toUpperCase() : data[field].trim();
    return entered === saved[field];
  });
}

/**
 * The delivery address an auction winner sends with the payment method. The
 * winner's order is created at close, before anyone said where to ship, so
 * the order page asks for it. It is sealed to the seller's published delivery
 * key like a checkout address, bound to the order id; a seller with no key
 * stops it with the same inline notice checkout shows.
 */
export function useAuctionWinnerDeliveryAddress({
  sellerPubky,
  orderId,
  enabled,
}: {
  sellerPubky: string;
  orderId: string;
  enabled: boolean;
}): {
  form: UseFormReturn<AuctionWinnerAddressData>;
  /** Saved addresses in picker order (default first, then last used). */
  addresses: CommerceDeliveryAddressModelSchema[];
  /** Composite row id of the applied saved address; null while entering a new one. */
  selectedAddressId: string | null;
  selectAddress: (id: string | null) => void;
  /** Validates the form, resolves the seller's key and seals; stops with `ok: false` and the reason on screen. */
  prepare: () => Promise<AuctionWinnerDeliveryResult>;
  /** Marks the saved address used once the bind succeeded. */
  rememberUsed: () => Promise<void>;
  pendingKeyChange: PendingDeliveryKeyChange | null;
  decideKeyChange: (accepted: boolean) => void;
  deliveryKeyBlock: DeliveryKeyBlock | null;
} {
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const appliedInitialAddressRef = useRef(false);
  const {
    resolveKeys,
    pendingChange: pendingKeyChange,
    decide: decideKeyChange,
    blocked: deliveryKeyBlock,
  } = useDeliveryKeyGate();
  const form = useForm<AuctionWinnerAddressData>({
    resolver: zodResolver(auctionWinnerAddressSchema),
    defaultValues: auctionWinnerAddressDefaults,
    mode: 'onTouched',
  });

  const addresses = useLiveQuery(
    async () => {
      if (!enabled || !currentUserPubky) return [];
      return await CommerceController.getDeliveryAddresses();
    },
    [enabled, currentUserPubky],
    [] as CommerceDeliveryAddressModelSchema[],
  );

  // A new address starts in the browser's country, set after mount so the
  // server-rendered form and the first client render agree.
  useEffect(() => {
    if (!enabled || form.getFieldState('countryCode').isDirty) return;
    form.reset({ ...form.getValues(), countryCode: browserAddressCountry() }, { keepDirtyValues: true });
  }, [enabled, form]);

  // Pre-fill once from the picker's top address, never over what was typed.
  useEffect(() => {
    if (!enabled || appliedInitialAddressRef.current) return;
    const first = addresses[0];
    if (!first) return;
    appliedInitialAddressRef.current = true;
    if (form.formState.isDirty) return;
    form.reset(savedAddressValues(first));
    setSelectedAddressId(first.id);
  }, [enabled, addresses, form]);

  // Editing any field after picking a saved address makes it a new address again.
  const watchedValues = useWatch({
    control: form.control,
    name: AUCTION_WINNER_ADDRESS_FIELDS as unknown as Array<(typeof AUCTION_WINNER_ADDRESS_FIELDS)[number]>,
  });
  useEffect(() => {
    setSelectedAddressId((current) => {
      if (current === null) return null;
      const selected = addresses.find(({ id }) => id === current);
      if (!selected) return null;
      return matchesSaved(form.getValues(), selected) ? current : null;
    });
  }, [addresses, watchedValues, form]);

  const selectAddress = (id: string | null) => {
    if (id === null) {
      setSelectedAddressId(null);
      return;
    }
    const address = addresses.find((candidate) => candidate.id === id);
    if (!address) return;
    form.reset(savedAddressValues(address));
    setSelectedAddressId(id);
  };

  const prepare = async (): Promise<AuctionWinnerDeliveryResult> => {
    if (!(await form.trigger())) return { ok: false };
    const parsed = commerceDeliveryAddressValueSchema.safeParse(form.getValues());
    if (!parsed.success) return { ok: false };
    const address = parsed.data;
    const destinationError = await checkDestinationCountry(address.countryCode, [sellerPubky]);
    if (destinationError) {
      form.setError('countryCode', { type: 'custom', message: destinationError }, { shouldFocus: true });
      return { ok: false };
    }
    const gate = await resolveKeys([sellerPubky]);
    if (!gate.ok) return { ok: false };
    const key = gate.keys.get(sellerPubky);
    if (!key) return { ok: true, delivery: { deliveryAddress: address } };
    const [sealed] = await CommerceController.sealDeliveryAddressForCheckout({
      checkoutCommandId: orderId,
      address,
      keys: new Map([[sellerPubky, key]]),
    });
    return { ok: true, delivery: { deliveryAddressEnvelope: { keyId: sealed.keyId, envelope: sealed.envelope } } };
  };

  const rememberUsed = async () => {
    const selected = addresses.find(({ id }) => id === selectedAddressId);
    if (!selected || !matchesSaved(form.getValues(), selected)) return;
    try {
      await CommerceController.commitMarkDeliveryAddressUsed(bareAddressId(selected));
    } catch {
      // The bind already succeeded; a missed last-used stamp must not look like a failed payment.
    }
  };

  return {
    form,
    addresses,
    selectedAddressId,
    selectAddress,
    prepare,
    rememberUsed,
    pendingKeyChange,
    decideKeyChange,
    deliveryKeyBlock,
  };
}
