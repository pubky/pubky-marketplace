'use client';

import { useEffect, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import type { InventoryImportUnfinished } from '@/application/commerce/inventory-import';
import { CommerceController } from '@/controllers/commerce/commerce';
import { ImportStoreCatalogController } from '@/controllers/import-store/import-store-catalog';
import { runImportImageBatches } from '@/hooks/useImportImageUpload/runImportImageBatches';
import { toast } from '@/molecules/Toaster/use-toast';
import type {
  InventoryImportDryRunCounts,
  InventoryImportScene,
} from '@/organisms/Marketplace/MarketplaceInventoryImport';
import {
  type ImportLossReport,
  type ImportSourceFormat,
  lossReportToCsv,
  summarizeLossReport,
} from '@/pipes/commerce/import-loss-report';
import { gateNotice, type ImportPublishGate, keptLiveLine } from '@/pipes/commerce/import-publish-gate';
import { type ImportSettings, missingImportChoices } from '@/pipes/commerce/import-settings';
import { storeCurrency, type WooStoreCatalog } from '@/pipes/commerce/import-woo-store';
import { ImportStoreValidators } from '@/pipes/import-store/import-store.validators';
import {
  IMPORT_CONDITION_OPTIONS,
  IMPORT_CURRENCY_OPTIONS,
  IMPORT_SETTINGS_FIELDS,
  type ImportSettingsFormData,
  importSettingsFormDefaults,
  importSettingsFormSchema,
  type ImportStoreUrlFormData,
  importStoreUrlFormDefaults,
  importStoreUrlFormSchema,
  shippingFormValues,
  toImportSettings,
} from './useMarketplaceInventoryImport.types';

const PARSE_FAIL_COPY = 'This file could not be planned. Nothing was published.';

function downloadText(content: BlobPart, type: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function useMarketplaceInventoryImport(sellerPubky: string | null) {
  const [scene, setScene] = useState<InventoryImportScene>('upload');
  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [counts, setCounts] = useState<InventoryImportDryRunCounts | undefined>();
  const [manifestId, setManifestId] = useState<string | null>(null);
  const [conflictListingId, setConflictListingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | undefined>();
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<ImportSourceFormat | undefined>();
  const [lossReport, setLossReport] = useState<ImportLossReport | undefined>();
  const [progressPhase, setProgressPhase] = useState<'photos' | 'listings'>('listings');
  const [unfinished, setUnfinished] = useState<InventoryImportUnfinished | undefined>();
  const [photoPlan, setPhotoPlan] = useState<{ count: number; batches: number; pauses: number } | undefined>();
  const [batchInfo, setBatchInfo] = useState<{ batch: number; batches: number } | undefined>();
  const [waitSeconds, setWaitSeconds] = useState<number | null>(null);
  const [fetchPhase, setFetchPhase] = useState<'pages' | 'variations'>('pages');
  const sourceFile = useRef<File | null>(null);
  const sourceStore = useRef<WooStoreCatalog | null>(null);
  const storeRun = useRef<AbortController | null>(null);
  const imageRun = useRef<AbortController | null>(null);
  const defaultsLoaded = useRef(false);
  const [appliedSettings, setAppliedSettings] = useState<ImportSettings | undefined>();
  const [publishGate, setPublishGate] = useState<ImportPublishGate | undefined>();

  const form = useForm<ImportSettingsFormData>({
    resolver: zodResolver(importSettingsFormSchema),
    defaultValues: importSettingsFormDefaults,
    mode: 'onChange',
  });

  const watched = useWatch({ control: form.control });

  useEffect(() => {
    void loadUnfinished();
    // loadUnfinished only reads the seller's stored imports; it re-runs when the seller changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellerPubky]);

  const storeForm = useForm<ImportStoreUrlFormData>({
    resolver: zodResolver(importStoreUrlFormSchema),
    defaultValues: importStoreUrlFormDefaults,
    mode: 'onSubmit',
  });

  const reset = () => {
    imageRun.current?.abort();
    storeRun.current?.abort();
    storeRun.current = null;
    sourceStore.current = null;
    setFetchPhase('pages');
    storeForm.reset(importStoreUrlFormDefaults);
    setProgressPhase('listings');
    setScene('upload');
    setStep(1);
    setFileName(undefined);
    setMessage(undefined);
    setCounts(undefined);
    setManifestId(null);
    setConflictListingId(null);
    setProgress(undefined);
    setBusy(false);
    setFormat(undefined);
    setLossReport(undefined);
    sourceFile.current = null;
    defaultsLoaded.current = false;
    setAppliedSettings(undefined);
    setPublishGate(undefined);
    setPhotoPlan(undefined);
    setBatchInfo(undefined);
    setWaitSeconds(null);
    form.reset(importSettingsFormDefaults);
    void loadUnfinished();
  };

  /** Plans whatever the seller brought: the file, or the store catalogue already read. Resolves true when the dry run is ready. */
  const plan = async (label: string): Promise<boolean> => {
    if (!sellerPubky) return false;
    const file = sourceFile.current;
    const catalog = sourceStore.current;
    if (!file && !catalog) return false;
    setBusy(true);
    setFileName(label);
    setScene('validation');
    setStep(2);
    const settings = toImportSettings(form.getValues());
    const result = catalog
      ? await CommerceController.planInventoryStoreImport(sellerPubky, catalog, settings, IMPORT_CURRENCY_OPTIONS)
      : await CommerceController.planInventoryImport(sellerPubky, file as File, settings);
    setBusy(false);
    if (result.status === 'parse-failed') {
      setScene(result.message.startsWith('This file exceeds') ? 'limit' : 'parse-fail');
      setMessage(result.message);
      return false;
    }
    if (result.status !== 'planned') {
      setScene('parse-fail');
      setMessage(PARSE_FAIL_COPY);
      return false;
    }
    setManifestId(result.manifestId);
    setCounts(result.counts);
    setFormat(result.format);
    setLossReport(result.lossReport);
    setAppliedSettings(settings);
    setPublishGate(result.publishGate);
    setPhotoPlan(result.photos);
    setConflictListingId(null);
    setScene(result.counts.conflict > 0 ? 'conflict' : 'dry-run');
    setStep(result.counts.conflict > 0 ? 5 : 4);
    return true;
  };

  /**
   * Prefills the ships-from country from the seller's shop and the shipping
   * option from their latest listing, once per import, into fields the seller
   * has not touched. Anything the seller has no answer for stays empty and is
   * required in the dry run.
   */
  const prefillFromShop = async () => {
    if (!sellerPubky || defaultsLoaded.current) return;
    defaultsLoaded.current = true;
    try {
      const defaults = await CommerceController.inventoryImportDefaults(sellerPubky);
      const pristine = (name: keyof ImportSettingsFormData) => !form.getFieldState(name).isDirty;
      if (defaults.countryCode && pristine(IMPORT_SETTINGS_FIELDS.COUNTRY_CODE)) {
        form.setValue(IMPORT_SETTINGS_FIELDS.COUNTRY_CODE, defaults.countryCode);
      }
      const shippingFields = [
        IMPORT_SETTINGS_FIELDS.SHIPPING_MODE,
        IMPORT_SETTINGS_FIELDS.SHIPPING_PRICE,
        IMPORT_SETTINGS_FIELDS.SHIPPING_MIN_DAYS,
        IMPORT_SETTINGS_FIELDS.SHIPPING_MAX_DAYS,
      ] as const;
      if (defaults.shipping && shippingFields.every(pristine)) {
        const offered = defaults.currency !== null && IMPORT_CURRENCY_OPTIONS.includes(defaults.currency);
        const currency = offered && pristine('currency') ? (defaults.currency as string) : form.getValues('currency');
        if (defaults.shipping.mode === 'free' || defaults.currency === currency) {
          form.setValue('currency', currency as ImportSettingsFormData['currency']);
          const values = shippingFormValues(defaults.shipping, currency);
          form.setValue(IMPORT_SETTINGS_FIELDS.SHIPPING_MODE, values.shippingMode);
          form.setValue(IMPORT_SETTINGS_FIELDS.SHIPPING_PRICE, values.shippingPrice);
          form.setValue(IMPORT_SETTINGS_FIELDS.SHIPPING_MIN_DAYS, values.shippingMinDays);
          form.setValue(IMPORT_SETTINGS_FIELDS.SHIPPING_MAX_DAYS, values.shippingMaxDays);
        }
      }
    } catch {
      // Nothing to prefill: the dry run asks for both.
    }
  };

  const planFile = async (file: File) => {
    sourceFile.current = file;
    sourceStore.current = null;
    setFormat(undefined);
    setLossReport(undefined);
    await prefillFromShop();
    await plan(file.name);
  };

  /**
   * Reads the public catalogue of the WooCommerce store whose address is in
   * the store form (no keys, through the server route), takes the store's
   * currency as the listing currency when listings can be priced in it, then
   * plans the catalogue into the same dry run as a file. Resolves true when
   * the dry run is ready.
   */
  const submitStoreUrl = async (): Promise<boolean> => {
    if (!sellerPubky || busy) return false;
    if (!(await storeForm.trigger())) return false;
    const address = ImportStoreValidators.validateStoreUrl(storeForm.getValues('storeUrl'));
    if (!address.ok) return false;
    const label = address.base.host;

    const controller = new AbortController();
    storeRun.current = controller;
    sourceFile.current = null;
    sourceStore.current = null;
    setFormat(undefined);
    setLossReport(undefined);
    setBusy(true);
    setFileName(label);
    setScene('fetch');
    setStep(2);
    setFetchPhase('pages');
    setProgress({ done: 0, total: 1 });
    const fetched = await ImportStoreCatalogController.fetchCatalog({
      storeUrl: ImportStoreValidators.baseText(address.base),
      signal: controller.signal,
      onProgress: ({ phase, done, total }) => {
        setFetchPhase(phase);
        setProgress({ done, total });
      },
    });
    if (controller.signal.aborted) return false;
    if (storeRun.current === controller) storeRun.current = null;
    if (!fetched.ok) {
      setBusy(false);
      setScene('parse-fail');
      setMessage(fetched.message);
      return false;
    }

    sourceStore.current = fetched.catalog;
    const currency = storeCurrency(fetched.catalog.products);
    if (currency && IMPORT_CURRENCY_OPTIONS.includes(currency)) {
      form.setValue(IMPORT_SETTINGS_FIELDS.CURRENCY, currency as ImportSettingsFormData['currency'], {
        shouldDirty: true,
      });
    }
    await prefillFromShop();
    setProgress(undefined);
    return plan(label);
  };

  /** Re-plans the same file or store catalogue with the settings now in the form; resolves true when the dry-run is ready. */
  const applySettings = async (): Promise<boolean> => {
    if (!sourceFile.current && !sourceStore.current) return false;
    if (!(await form.trigger())) return false;
    const planned = await plan(fileName ?? '');
    if (!planned) {
      toast({ variant: 'error', description: 'The import could not be planned with these settings.' });
    }
    return planned;
  };

  /** One click on "Use free shipping": picks it and re-plans, when the rest of the settings are valid. */
  const chooseFreeShipping = async (): Promise<boolean> => {
    form.setValue(IMPORT_SETTINGS_FIELDS.SHIPPING_MODE, 'free', { shouldDirty: true, shouldValidate: true });
    return applySettings();
  };

  const applyPublishResult = (result: Awaited<ReturnType<typeof CommerceController.publishInventoryImport>>) => {
    if (result.status === 'conflict') {
      setScene('conflict');
      setConflictListingId(result.listingId);
      setMessage(result.message);
      return;
    }
    if (result.status === 'rate-limited') {
      setScene('mixed');
      setMessage(result.message);
      return;
    }
    if (result.status === 'complete') {
      setProgress({ done: result.synced + result.failed, total: result.synced + result.failed });
      setScene(result.mixed ? 'mixed' : 'result');
      setStep(6);
      setMessage(result.message);
      setConflictListingId(null);
      return;
    }
    setScene('parse-fail');
    setMessage(result.status === 'error' ? result.message : PARSE_FAIL_COPY);
  };

  /** An import that ended, whatever way, is looked for again, so the banner never shows one that is finished or misses one that stopped. */
  const applyPublishOutcome = (result: Awaited<ReturnType<typeof CommerceController.publishInventoryImport>>) => {
    applyPublishResult(result);
    void loadUnfinished();
  };

  /**
   * Fetches the photos the preset kept as source URLs and stores them as the
   * seller's own media, in batches, then writes each finished listing's media
   * onto its planned rows. Batches run one after another, waiting when the
   * route asks, until every photo is done, so the seller needs no second
   * import. Listings that already hold media are skipped, so a resume (after a
   * pause or a reload) continues with what is left and never uploads twice.
   * `cancelled`: the dialog closed. `interrupted`: photos are left for a resume,
   * so nothing is published yet.
   */
  const runImagePhase = async (id: string, photosTotal: number): Promise<'done' | 'interrupted' | 'cancelled'> => {
    if (!sellerPubky) return 'cancelled';
    const controller = new AbortController();
    imageRun.current = controller;
    setProgressPhase('photos');
    setProgress({ done: 0, total: photosTotal });
    setBatchInfo(undefined);
    setWaitSeconds(null);
    try {
      const run = await runImportImageBatches({
        ownerPubky: sellerPubky,
        loadTargets: () => CommerceController.inventoryImportImageTargets(sellerPubky, id),
        knownMedia: (urls) => CommerceController.inventoryImportKnownMedia(sellerPubky, id, urls),
        journal: (rowIdentity, url, media) =>
          CommerceController.journalInventoryImportPhoto(sellerPubky, id, rowIdentity, url, media),
        attach: (outcomes) => CommerceController.attachInventoryImportImages(sellerPubky, id, outcomes),
        signal: controller.signal,
        onProgress: ({ done, total, batch, batches }) => {
          setProgress({ done, total });
          setBatchInfo(batches > 1 ? { batch, batches } : undefined);
        },
        onWait: setWaitSeconds,
      });
      if (run.status === 'cancelled' || controller.signal.aborted) return 'cancelled';
      if (run.status === 'interrupted') {
        setMessage(
          `Photos are paused: ${run.done} of ${run.total} loaded. The photo service needs a rest. Resume to load the rest; nothing is published for those listings yet.`,
        );
        return 'interrupted';
      }
      return 'done';
    } catch {
      toast({
        variant: 'error',
        description: 'Photos could not be saved. Resume to load the rest; nothing is published for those listings yet.',
      });
      setMessage(
        'Photos are paused after an error. Resume to load the rest; nothing is published for those listings yet.',
      );
      return 'interrupted';
    } finally {
      if (imageRun.current === controller) imageRun.current = null;
      setWaitSeconds(null);
      setBatchInfo(undefined);
    }
  };

  /** Photos, then listings. Stops with the Resume scene when the photos could not all be loaded. */
  const photosThen = async (
    id: string,
    photosTotal: number,
    publishStep: () => Promise<Awaited<ReturnType<typeof CommerceController.publishInventoryImport>>>,
    listingsTotal?: number,
  ) => {
    const photos = await runImagePhase(id, photosTotal);
    if (photos === 'cancelled') {
      void loadUnfinished();
      return;
    }
    if (photos === 'interrupted') {
      setBusy(false);
      setScene('mixed');
      setStep(6);
      void loadUnfinished();
      return;
    }
    setProgressPhase('listings');
    if (listingsTotal !== undefined) setProgress({ done: 0, total: listingsTotal });
    const result = await publishStep();
    setBusy(false);
    applyPublishOutcome(result);
  };

  const publish = async () => {
    if (!sellerPubky || !manifestId) return;
    setBusy(true);
    setScene('progress');
    setStep(5);
    await CommerceController.markInventoryImportStarted(sellerPubky, manifestId);
    await photosThen(
      manifestId,
      photoPlan?.count ?? 0,
      () => CommerceController.publishInventoryImport(sellerPubky, manifestId),
      counts ? counts.create + counts.update + counts.end : 0,
    );
  };

  const resume = async () => {
    if (!sellerPubky || !manifestId) return;
    setBusy(true);
    setScene('progress');
    await photosThen(manifestId, photoPlan?.count ?? 0, () =>
      CommerceController.resumeInventoryImport(sellerPubky, manifestId),
    );
  };

  /** Looks for an import the seller started and did not finish, to offer it for resume or discard. */
  const loadUnfinished = async () => {
    if (!sellerPubky) {
      setUnfinished(undefined);
      return;
    }
    try {
      setUnfinished((await CommerceController.findUnfinishedInventoryImport(sellerPubky)) ?? undefined);
    } catch {
      setUnfinished(undefined);
    }
  };

  /**
   * Carries on an unfinished import from the plan stored on this device: the
   * photo batches that are left, then the publish, exactly where they stopped.
   * Rows that hold media are skipped and photos already stored are reused, so
   * nothing is uploaded twice. Works after the dialog was closed or the page reloaded.
   */
  const resumeUnfinished = async () => {
    if (!sellerPubky || !unfinished || busy) return;
    const found = unfinished;
    imageRun.current?.abort();
    setUnfinished(undefined);
    setManifestId(found.manifestId);
    setConflictListingId(null);
    setFileName(undefined);
    setMessage(undefined);
    setBusy(true);
    setScene('progress');
    setStep(5);
    await photosThen(found.manifestId, found.photosLeft, () =>
      CommerceController.resumeInventoryImport(sellerPubky, found.manifestId),
    );
  };

  /**
   * Clears an unfinished import, after the seller has confirmed. What it already
   * published stays published; the photo files it uploaded that no published
   * listing refers to are deleted from the seller's homeserver. If a file cannot
   * be deleted the import is kept, and the seller is told, so Discard can be tried again.
   */
  const discardUnfinished = async () => {
    if (!sellerPubky || !unfinished || busy) return;
    const found = unfinished;
    setBusy(true);
    try {
      const result = await CommerceController.discardInventoryImport(sellerPubky, found.manifestId);
      if (!result.cleared) {
        toast({
          variant: 'error',
          description: `${result.failedFiles} photo ${result.failedFiles === 1 ? 'file' : 'files'} could not be removed from your homeserver, so the import was kept. Try Discard again.`,
        });
      }
    } catch {
      toast({ variant: 'error', description: 'The import could not be discarded. Try again.' });
    } finally {
      setBusy(false);
    }
    await loadUnfinished();
  };

  const applyConflictResult = (
    result: Awaited<ReturnType<typeof CommerceController.confirmInventoryImportConflict>>,
  ) => {
    if (result.status === 'planned') {
      setCounts(result.counts);
      setConflictListingId(null);
      setScene(result.counts.conflict > 0 ? 'conflict' : 'dry-run');
      setStep(result.counts.conflict > 0 ? 5 : 4);
      return;
    }
    applyPublishOutcome(result);
  };

  const confirmConflict = async () => {
    if (!sellerPubky || !manifestId) return;
    setBusy(true);
    const result = await CommerceController.confirmInventoryImportConflict(
      sellerPubky,
      manifestId,
      conflictListingId ?? '',
    );
    setBusy(false);
    applyConflictResult(result);
  };

  const discardConflict = async () => {
    if (!sellerPubky || !manifestId) return;
    setBusy(true);
    const result = await CommerceController.discardInventoryImportConflict(
      sellerPubky,
      manifestId,
      conflictListingId ?? '',
    );
    setBusy(false);
    applyConflictResult(result);
  };

  const downloadResult = async () => {
    if (!sellerPubky || !manifestId) return;
    downloadText(
      await CommerceController.inventoryImportResultCsv(sellerPubky, manifestId),
      'text/csv',
      'inventory-import-result.csv',
    );
  };

  const downloadLossReport = () => {
    if (!lossReport) return;
    downloadText(lossReportToCsv(lossReport), 'text/csv', 'inventory-import-loss-report.csv');
  };

  const exportListings = async () => {
    if (!sellerPubky) return;
    const bytes = await CommerceController.exportInventoryListingsCsv(sellerPubky);
    downloadText(new Uint8Array(bytes), 'text/csv', 'listings.csv');
  };

  const exportOrders = async () => {
    if (!sellerPubky) return;
    downloadText(await CommerceController.exportInventoryOrdersJson(sellerPubky), 'application/json', 'orders.json');
  };

  const formSettings = toImportSettings({ ...importSettingsFormDefaults, ...watched });
  const missing = appliedSettings ? missingImportChoices(formSettings) : [];
  const settingsChanged =
    appliedSettings !== undefined && JSON.stringify(appliedSettings) !== JSON.stringify(formSettings);
  let publishDisabledReason: string | undefined;
  if (format) {
    if (missing.length === 2) {
      publishDisabledReason = 'Choose a shipping option and where your listings ship from, then apply the settings.';
    } else if (missing[0] === 'shipping') {
      publishDisabledReason = 'Choose a shipping option, then apply the settings.';
    } else if (missing[0] === 'countryCode') {
      publishDisabledReason = 'Choose where your listings ship from, then apply the settings.';
    } else if (settingsChanged) {
      publishDisabledReason = 'Apply your changed settings before publishing.';
    }
  }

  return {
    scene,
    step,
    fileName,
    message,
    counts,
    progress,
    progressPhase,
    batchInfo,
    waitSeconds,
    photoPlan,
    unfinished,
    resumeUnfinished,
    discardUnfinished,
    fetchPhase,
    busy,
    format,
    storeForm,
    lossSummary: lossReport ? summarizeLossReport(lossReport) : undefined,
    form,
    currencyOptions: IMPORT_CURRENCY_OPTIONS,
    conditionOptions: IMPORT_CONDITION_OPTIONS,
    reset,
    planFile,
    submitStoreUrl,
    applySettings,
    chooseFreeShipping,
    publishDisabledReason,
    publishNotice: publishGate?.reason
      ? {
          ...gateNotice(publishGate.reason, { pausing: publishGate.pausing, keptLive: publishGate.keptLive.length }),
          ...(publishGate.keptLive.length > 0
            ? {
                keptLive: {
                  line: keptLiveLine(publishGate.reason),
                  titles: publishGate.keptLive.slice(0, 5).map((listing) => listing.title),
                  total: publishGate.keptLive.length,
                },
              }
            : {}),
        }
      : undefined,
    publish,
    resume,
    confirmConflict,
    discardConflict,
    downloadResult,
    downloadLossReport,
    exportListings,
    exportOrders,
  };
}
