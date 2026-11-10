'use client';

import { useEffect, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type UseFormReturn, useWatch } from 'react-hook-form';
import { getCommerceAdapterMode, isDurableCommerceMode } from '@/config/commerce';
import { commerceAttributeFieldsFor } from '@/config/taxonomy/taxonomy';
import { CommerceController } from '@/controllers/commerce/commerce';
import {
  buildListingVariants,
  buildPackageRecord,
  deriveTags,
  describeMediaFailure,
  listingAttributesFromFormData,
  resolveListingShipping,
  sellerDeliveryKeyRequirement,
  uploadListingMedia,
} from '@/hooks/useCreateMarketplaceListing/useCreateMarketplaceListing';
import {
  type CreateMarketplaceListingData,
  createMarketplaceListingDefaults,
  createMarketplaceListingSchema,
  fulfillmentFormValueFromRecord,
  fulfillmentMethodsFromForm,
  fulfillmentRequiresShipping,
  listingAttributeFormField,
} from '@/hooks/useCreateMarketplaceListing/useCreateMarketplaceListing.types';
import {
  useListingMediaManager,
  type UseListingMediaManagerResult,
} from '@/hooks/useListingMediaManager/useListingMediaManager';
import { useMeasurementSystem } from '@/hooks/useMeasurementSystem/useMeasurementSystem';
import { usePaykitRecovery } from '@/hooks/usePaykitRecovery/usePaykitRecovery';
import type { ConnectorSyncGroup } from '@/libs/commerce/connectors';
import {
  evaluateDurableListingPublishGuards,
  type ListingPublishBlockReason,
  listingPublishBlockToast,
} from '@/libs/commerce/listing-publish-guards';
import { listingShippingFormFromRecord, type ListingShippingRecordFields } from '@/libs/commerce/listing-shipping';
import { type CommerceListingRecord, commerceListingRecordSchema } from '@/libs/commerce/marketplace-records';
import {
  amountInputFromMoney,
  amountInputToMoney,
  assetForListingCurrency,
  type ListingCurrencyChoice,
  listingCurrencyChoiceForAsset,
} from '@/libs/commerce/pricing';
import { publishedCountryCode } from '@/libs/commerce/ships-to';
import type { CommerceMoney } from '@/libs/commerce/transaction-contracts';
import { dimensionInputFromMillimeters, type MeasurementSystem, weightInputFromGrams } from '@/libs/commerce/units';
import { stockFormFields } from '@/libs/commerce/unlimited-stock';
import { toast } from '@/molecules/Toaster/toast';
import { type FollowedGroups, keepFollowedFields, NO_FOLLOWED_GROUPS } from '@/pipes/commerce/listing-followed-fields';
import { useAuthStore } from '@/stores/auth/auth.store';
import { useCommerceStore } from '@/stores/commerce/commerce.store';

export type EditMarketplaceListingStatus = 'loading' | 'ready' | 'not-found' | 'not-owner' | 'unsupported';

export interface UseEditMarketplaceListingResult {
  status: EditMarketplaceListingStatus;
  form: UseFormReturn<CreateMarketplaceListingData>;
  media: UseListingMediaManagerResult;
  /** True for auction listings: the sale terms were fixed at publish time. */
  saleTermsLocked: boolean;
  publishBlocked: ListingPublishBlockReason | null;
  publishGuardReady: boolean;
  submit: (options?: { silent?: boolean }) => Promise<string | null>;
  /**
   * The seller's own record once it has loaded, including listings this studio cannot edit (`unsupported`):
   * the edit page offers Delete for those too.
   */
  ownedListing: CommerceListingRecord | null;
  /**
   * Puts the form's fields of one group back to the published record's values: for a group that follows a
   * connected store again after the seller edited it here, so a read-only field never shows a value the
   * save will not write.
   */
  resetFollowedGroup: (group: ConnectorSyncGroup) => void;
}

export interface UseEditMarketplaceListingOptions {
  /**
   * The parts of the listing that follow a connected store. A followed part is saved as the published record
   * has it, whatever the form holds, and its photos are not uploaded.
   */
  follows?: FollowedGroups;
  /**
   * False while the connected stores the listing is linked to are not known yet, or could not be asked. No
   * save goes out then, whichever button asks for it: the form cannot tell what is read-only.
   */
  storeSyncReady?: boolean;
}

/**
 * The edit side of the sell studio: hydrates the form and photo set from the
 * seller's published record and republishes the SAME listing (same
 * `listingId`, same `createdAt`) with a bumped revision. Already-uploaded
 * photos are reused as-is — only newly added photos upload bytes.
 *
 * Honest scope limits, enforced as `unsupported` instead of destructive
 * saves: Locks listings (a `digitalLock` this studio cannot author) cannot
 * be edited here; listings priced in an asset the studio
 * cannot author (anything that is neither USD cents nor BTC base units) cannot
 * be edited here, because "editing" one would silently rewrite its price
 * into a different asset; and auction sale terms are locked because
 * rewriting a live auction's window or starting price would falsify terms
 * bidders may already have acted on. Item facts (title, description, photos,
 * inventory, delivery) stay editable for auctions.
 */
export function useEditMarketplaceListing(
  sellerPubky: string,
  listingId: string,
  options: UseEditMarketplaceListingOptions = {},
): UseEditMarketplaceListingResult {
  const follows = options.follows ?? NO_FOLLOWED_GROUPS;
  const storeSyncReady = options.storeSyncReady !== false;
  // A save that is already running reads these when it commits, not the values it started with: a group that
  // began following a store while the save awaited media or shipping must still be saved as published.
  const followsRef = useRef(follows);
  const storeSyncReadyRef = useRef(storeSyncReady);
  useEffect(() => {
    followsRef.current = follows;
    storeSyncReadyRef.current = storeSyncReady;
  });
  const currentUserPubky = useAuthStore((state) => state.currentUserPubky);
  const marketplaceSession = useCommerceStore((state) => state.marketplaceSession);
  const measurementSystem = useMeasurementSystem();
  const media = useListingMediaManager();
  const [status, setStatus] = useState<EditMarketplaceListingStatus>('loading');
  const [record, setRecord] = useState<CommerceListingRecord | null>(null);
  const [ownedListing, setOwnedListing] = useState<CommerceListingRecord | null>(null);
  const hydratedReservePriceRef = useRef<CommerceMoney | null | undefined>(undefined);
  const durablePublish = isDurableCommerceMode(getCommerceAdapterMode());
  const [publishBlocked, setPublishBlocked] = useState<ListingPublishBlockReason | null>(null);
  const paykitRecheck = usePaykitRecovery(publishBlocked === 'paykit-unreachable');
  const guardInputsRef = useRef<string | null>(null);
  const [publishGuardReady, setPublishGuardReady] = useState(!durablePublish);
  const form = useForm<CreateMarketplaceListingData>({
    resolver: zodResolver(createMarketplaceListingSchema),
    defaultValues: createMarketplaceListingDefaults,
    mode: 'onChange',
  });
  const watchedFulfillment = useWatch({ control: form.control, name: 'fulfillment' });
  const shipsListing = fulfillmentRequiresShipping(watchedFulfillment ?? createMarketplaceListingDefaults.fulfillment);

  useEffect(() => {
    let active = true;
    if (!currentUserPubky) return;
    if (currentUserPubky !== sellerPubky) {
      setStatus('not-owner');
      return;
    }
    CommerceController.getOrFetchListing(sellerPubky, listingId)
      .then(async (loaded) => {
        const sellerProjection =
          loaded.sale.format === 'auction' && isDurableCommerceMode(getCommerceAdapterMode())
            ? await CommerceController.getMarketplaceSellerListingProjection(sellerPubky, listingId)
            : null;
        if (!active) return;
        setOwnedListing(loaded);
        if (loaded.digitalLock !== undefined) {
          setStatus('unsupported');
          return;
        }
        const primaryPrice = loaded.sale.format === 'fixed_price' ? loaded.sale.unitPrice : loaded.sale.startingPrice;
        const currency = listingCurrencyChoiceForAsset(primaryPrice);
        if (currency === null) {
          setStatus('unsupported');
          return;
        }
        hydratedReservePriceRef.current = sellerProjection?.reservePrice;
        setRecord(loaded);
        form.reset(formDataFromRecord(loaded, currency, measurementSystem, sellerProjection?.reservePrice ?? null));
        media.seed(loaded.media);
        setStatus('ready');
      })
      .catch(() => {
        if (active) setStatus('not-found');
      });
    return () => {
      active = false;
    };
    // `form` and `media` are stable hook results; re-running on their identity
    // would re-seed and clobber in-progress edits. `measurementSystem` is read
    // once at hydration for the same reason: converting in-progress inputs
    // under the user would silently change what the numbers mean.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserPubky, sellerPubky, listingId]);

  useEffect(() => {
    if (!durablePublish) {
      setPublishBlocked(null);
      setPublishGuardReady(true);
      return;
    }
    let active = true;
    // A recheck during an outage keeps the guard showing; changed inputs blank it again.
    const guardInputs = `${currentUserPubky}|${Boolean(marketplaceSession)}|${shipsListing}`;
    if (guardInputsRef.current !== guardInputs) setPublishGuardReady(false);
    guardInputsRef.current = guardInputs;
    void evaluateDurableListingPublishGuards({
      ownerPubky: currentUserPubky,
      hasMarketplaceSession: Boolean(marketplaceSession),
      loadPaymentConfig: (pubky) => CommerceController.getSellerPaymentConfig(pubky),
      loadUsdtPaymentsAvailable: () => CommerceController.fetchUsdtPaymentsAvailable(),
      deliveryKey: sellerDeliveryKeyRequirement(shipsListing),
    }).then((reason) => {
      if (!active) return;
      setPublishBlocked(reason);
      setPublishGuardReady(true);
    });
    return () => {
      active = false;
    };
  }, [currentUserPubky, durablePublish, marketplaceSession, shipsListing, paykitRecheck]);

  const submit = async (options?: { silent?: boolean }): Promise<string | null> => {
    if (!currentUserPubky || !record) return null;
    if (!storeSyncReady) {
      if (!options?.silent) {
        toast({
          variant: 'error',
          description: 'Your store connection is still being checked. Try again in a moment.',
        });
      }
      return null;
    }
    setPublishBlocked(null);
    if (durablePublish) {
      const reason = await evaluateDurableListingPublishGuards({
        ownerPubky: currentUserPubky,
        hasMarketplaceSession: Boolean(marketplaceSession),
        loadPaymentConfig: (pubky) => CommerceController.getSellerPaymentConfig(pubky),
        loadUsdtPaymentsAvailable: () => CommerceController.fetchUsdtPaymentsAvailable(),
        deliveryKey: sellerDeliveryKeyRequirement(fulfillmentRequiresShipping(form.getValues('fulfillment'))),
      });
      if (reason) {
        setPublishBlocked(reason);
        if (!options?.silent) toast(listingPublishBlockToast(reason));
        return null;
      }
    }
    let savedListingId: string | null = null;

    await form.handleSubmit(async (data) => {
      const refuseChangedRows = (groups: FollowedGroups): boolean => {
        if (!(groups.price || groups.variants) || data.variants.length === record.variants.length) return false;
        toast({
          variant: 'error',
          description: 'Variants cannot be added or removed here while they, or their prices, follow your store.',
        });
        return true;
      };
      if (refuseChangedRows(follows)) return;
      const preparedMedia = follows.content
        ? { ok: true as const, media: record.media as typeof record.media, uploads: [] }
        : await media.prepare(currentUserPubky);
      if (!preparedMedia.ok) {
        toast({ variant: 'error', description: describeMediaFailure(preparedMedia.reason) });
        return;
      }

      const shipping = await resolveListingShipping(currentUserPubky, data, record.shippingZones);
      if (!shipping.ok) {
        toast({ variant: 'error', description: shipping.errors[0] });
        return;
      }

      try {
        await uploadListingMedia(preparedMedia.uploads);
        if (!storeSyncReadyRef.current) {
          if (!options?.silent) {
            toast({
              variant: 'error',
              description: 'Your store connection changed while saving. Try again in a moment.',
            });
          }
          return;
        }
        // The groups followed now, which may differ from the ones this save started with: the rows are checked
        // against them again, and the record is built from the same snapshot.
        const followedNow = followsRef.current;
        if (refuseChangedRows(followedNow)) return;
        const updated = buildUpdatedRecord(record, data, preparedMedia.media, shipping.fields, followedNow);
        const reservePrice =
          updated.sale.format === 'auction' && data.reservePrice !== ''
            ? amountInputToMoney(data.reservePrice, assetForListingCurrency(data.currency))
            : hydratedReservePriceRef.current === undefined
              ? undefined
              : null;
        const { verified } = await CommerceController.commitUpsertListing(updated, reservePrice);
        setRecord(updated);
        savedListingId = `${currentUserPubky}:${updated.listingId}`;
        if (!options?.silent) {
          if (verified) {
            toast({ title: 'Listing updated', description: `Revision ${updated.revision} is now published.` });
          } else {
            // Acked write, read-back lagging — never "Could not save", which
            // sends the seller into a re-save that bumps the revision again.
            toast({
              title: 'Changes saved — confirmation pending',
              description:
                'Your homeserver accepted the update but has not served it back yet. Check the listing in a moment before saving again.',
            });
          }
        }
      } catch {
        toast({ variant: 'error', description: 'Could not save these changes.' });
      }
    })();

    return savedListingId;
  };

  const resetFollowedGroup = (group: ConnectorSyncGroup) => {
    if (!record) return;
    const primaryPrice = record.sale.format === 'fixed_price' ? record.sale.unitPrice : record.sale.startingPrice;
    const published = formDataFromRecord(
      record,
      listingCurrencyChoiceForAsset(primaryPrice) ?? form.getValues('currency'),
      form.getValues('measurementSystem'),
      hydratedReservePriceRef.current ?? null,
    );
    const touch = { shouldDirty: false, shouldValidate: true };
    if (group === 'content') {
      form.setValue('title', published.title, touch);
      form.setValue('description', published.description, touch);
      media.seed(record.media);
    } else if (form.getValues('variants').length !== published.variants.length) {
      // A row was removed or added here, so rows no longer line up with the published variants: take them all back.
      if (group === 'price') {
        form.setValue('currency', published.currency, touch);
        form.setValue('price', published.price, touch);
      }
      form.setValue('variants', published.variants, touch);
    } else if (group === 'price') {
      form.setValue('currency', published.currency, touch);
      form.setValue('price', published.price, touch);
      published.variants.forEach((variant, index) => {
        form.setValue(`variants.${index}.priceOverride`, variant.priceOverride, touch);
      });
    } else {
      published.variants.forEach((variant, index) => {
        form.setValue(`variants.${index}.sku`, variant.sku, touch);
        form.setValue(`variants.${index}.size`, variant.size, touch);
        form.setValue(`variants.${index}.color`, variant.color, touch);
        form.setValue(`variants.${index}.style`, variant.style, touch);
      });
    }
  };

  return {
    status,
    form,
    media,
    saleTermsLocked: record?.sale.format === 'auction',
    publishBlocked,
    publishGuardReady,
    submit,
    ownedListing,
    resetFollowedGroup,
  };
}

/**
 * Splits a record's attributes into values the studio form can manage
 * (keys in the record category's attribute set whose values fit the field's
 * shape and vocabulary) and everything else — foreign keys, foreign
 * vocabulary values, unexpected shapes. The passthrough half is preserved
 * verbatim on save so editing unrelated facts never destroys attributes this
 * client cannot express; form-managed keys are rewritten from the form.
 */
export function partitionListingAttributes(record: Pick<CommerceListingRecord, 'categoryId' | 'attributes'>): {
  formValues: Partial<CreateMarketplaceListingData>;
  passthrough: Record<string, string | string[]>;
} {
  const formValues: Partial<CreateMarketplaceListingData> = {};
  const passthrough: Record<string, string | string[]> = {};
  const fieldsByKey = new Map(commerceAttributeFieldsFor(record.categoryId).map((field) => [field.key, field]));

  for (const [key, value] of Object.entries(record.attributes ?? {})) {
    const field = fieldsByKey.get(key);
    const formField = field ? listingAttributeFormField(field.key) : null;
    if (!field || !formField) {
      passthrough[key] = value;
      continue;
    }
    if (field.input === 'multi-select') {
      const allowed = new Set((field.options ?? []).map((option) => option.value));
      if (
        Array.isArray(value) &&
        (field.maxValues === undefined || value.length <= field.maxValues) &&
        value.every((entry) => allowed.has(entry))
      ) {
        (formValues as Record<string, string | string[]>)[formField] = value;
      } else {
        passthrough[key] = value;
      }
      continue;
    }
    if (typeof value !== 'string') {
      passthrough[key] = value;
      continue;
    }
    if (field.input === 'select') {
      const allowed = new Set((field.options ?? []).map((option) => option.value));
      if (allowed.has(value)) {
        (formValues as Record<string, string | string[]>)[formField] = value;
      } else {
        passthrough[key] = value;
      }
      continue;
    }
    (formValues as Record<string, string | string[]>)[formField] = value;
  }

  return { formValues, passthrough };
}

export function formDataFromRecord(
  record: CommerceListingRecord,
  currency: ListingCurrencyChoice,
  measurementSystem: MeasurementSystem,
  reservePrice: CommerceMoney | null | undefined,
): CreateMarketplaceListingData {
  const price = record.sale.format === 'fixed_price' ? record.sale.unitPrice : record.sale.startingPrice;
  // Auctions are shipping-only (local pickup design §A2): an auction record
  // carrying pickup vocabulary predates the rule — the register path refuses
  // pickup auctions — so the editor hydrates it as shipping rather than
  // deadlocking the form on a combination the schema cannot accept.
  const fulfillment =
    record.sale.format === 'auction' ? 'shipping' : fulfillmentFormValueFromRecord(record.fulfillmentMethods);
  const flatShipping = record.shippingOptions.find((option) => option.pricing === 'flat');
  const freeShipping = record.shippingOptions.find((option) => option.pricing === 'free');
  const shippingOption = flatShipping ?? freeShipping;
  const returnDays =
    record.returnPolicy.acceptsReturns && record.returnPolicy.returnWindowDays !== undefined
      ? record.returnPolicy.returnWindowDays <= 14
        ? ('14' as const)
        : ('30' as const)
      : ('none' as const);

  return {
    ...createMarketplaceListingDefaults,
    ...partitionListingAttributes(record).formValues,
    title: record.title,
    description: record.description,
    categoryId: record.categoryId,
    condition: record.condition,
    countryCode: record.location.countryCode,
    region: record.location.region ?? '',
    saleFormat: record.sale.format,
    currency,
    price: amountInputFromMoney(price),
    reservePrice: reservePrice ? amountInputFromMoney(reservePrice) : '',
    variants: record.variants.map((variant) => ({
      sku: variant.sku ?? '',
      size: variant.options.size ?? '',
      color: variant.options.color ?? '',
      style: variant.options.style ?? '',
      ...stockFormFields(record, variant.quantity),
      priceOverride: variant.priceOverride ? amountInputFromMoney(variant.priceOverride) : '',
    })),
    fulfillment,
    ...listingShippingFormFromRecord(record, assetForListingCurrency(currency)),
    shippingLabel: shippingOption ? shippingOption.label : createMarketplaceListingDefaults.shippingLabel,
    freeShipping: freeShipping !== undefined,
    shippingPrice: flatShipping ? amountInputFromMoney(flatShipping.price) : '',
    shippingMinDays: shippingOption
      ? String(shippingOption.estimatedMinDays)
      : createMarketplaceListingDefaults.shippingMinDays,
    shippingMaxDays: shippingOption
      ? String(shippingOption.estimatedMaxDays)
      : createMarketplaceListingDefaults.shippingMaxDays,
    measurementSystem,
    packageWeight: record.package ? weightInputFromGrams(record.package.weightGrams, measurementSystem) : '',
    packageLength: record.package
      ? dimensionInputFromMillimeters(record.package.lengthMillimeters, measurementSystem)
      : '',
    packageWidth: record.package
      ? dimensionInputFromMillimeters(record.package.widthMillimeters, measurementSystem)
      : '',
    packageHeight: record.package
      ? dimensionInputFromMillimeters(record.package.heightMillimeters, measurementSystem)
      : '',
    returnDays,
  };
}

function buildUpdatedRecord(
  record: CommerceListingRecord,
  data: CreateMarketplaceListingData,
  media: CommerceListingRecord['media'],
  shipping: ListingShippingRecordFields,
  follows: FollowedGroups,
): CommerceListingRecord {
  const now = new Date().toISOString();
  const asset = assetForListingCurrency(data.currency);
  const unitPrice = amountInputToMoney(data.price, asset);
  // Auction sale terms are immutable after publish (see the hook doc); the
  // fixed-price branch rebuilds from the form but keeps the offers setting.
  const sale: CommerceListingRecord['sale'] =
    record.sale.format === 'auction'
      ? record.sale
      : { format: 'fixed_price', unitPrice, acceptsOffers: record.sale.acceptsOffers };
  const requiresShipping = fulfillmentRequiresShipping(data.fulfillment);
  const returnWindowDays = data.returnDays === 'none' ? undefined : Number(data.returnDays);

  // Attributes this client cannot express (foreign keys/values) survive the
  // save verbatim; the form's structured values win on shared keys.
  const attributes = {
    ...partitionListingAttributes(record).passthrough,
    ...listingAttributesFromFormData(data),
  };

  const fields = keepFollowedFields(
    record,
    { title: data.title, description: data.description, media, variants: buildListingVariants(data, media), sale },
    follows,
  );

  return commerceListingRecordSchema.parse({
    ...record,
    revision: record.revision + 1,
    updatedAt: now,
    title: fields.title,
    description: fields.description,
    categoryId: data.categoryId,
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
    condition: data.condition,
    tags: deriveTags(fields.title),
    location: {
      countryCode: publishedCountryCode(data.countryCode),
      region: data.region || undefined,
    },
    media: fields.media,
    variants: fields.variants,
    sale: fields.sale,
    fulfillmentMethods: fulfillmentMethodsFromForm(data.fulfillment),
    package: requiresShipping ? buildPackageRecord(data) : undefined,
    shippingOptions: requiresShipping ? shipping.shippingOptions : [],
    shippingProfileId: requiresShipping ? shipping.shippingProfileId : undefined,
    shippingZones: requiresShipping ? shipping.shippingZones : undefined,
    returnPolicy: {
      acceptsReturns: returnWindowDays !== undefined,
      returnWindowDays,
      buyerPaysReturnShipping: true,
    },
  });
}
