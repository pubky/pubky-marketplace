'use client';

import { useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { CommerceController } from '@/controllers/commerce/commerce';
import { uploadImportImages } from '@/hooks/useImportImageUpload/useImportImageUpload';
import { toast } from '@/molecules/Toaster/use-toast';
import type {
  InventoryImportDryRunCounts,
  InventoryImportScene,
} from '@/organisms/Marketplace/MarketplaceInventoryImport';
import {
  altTextForUrl,
  type ImportImageResult,
  outcomesFromResults,
  uniqueImageUrls,
} from '@/pipes/commerce/import-image-phase';
import {
  type ImportLossReport,
  type ImportSourceFormat,
  lossReportToCsv,
  summarizeLossReport,
} from '@/pipes/commerce/import-loss-report';
import type { PresetJson } from '@/pipes/commerce/import-preset-rows';
import { gateNotice, type ImportPublishGate, keptLiveLine } from '@/pipes/commerce/import-publish-gate';
import { type ImportSettings, missingImportChoices } from '@/pipes/commerce/import-settings';
import {
  IMPORT_CONDITION_OPTIONS,
  IMPORT_CURRENCY_OPTIONS,
  IMPORT_SETTINGS_FIELDS,
  type ImportSettingsFormData,
  importSettingsFormDefaults,
  importSettingsFormSchema,
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
  const sourceFile = useRef<File | null>(null);
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

  const reset = () => {
    imageRun.current?.abort();
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
    form.reset(importSettingsFormDefaults);
  };

  const plan = async (file: File): Promise<boolean> => {
    if (!sellerPubky) return false;
    setBusy(true);
    setFileName(file.name);
    setScene('validation');
    setStep(2);
    const settings = toImportSettings(form.getValues());
    const result = await CommerceController.planInventoryImport(sellerPubky, file, settings);
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
    setFormat(undefined);
    setLossReport(undefined);
    await prefillFromShop();
    await plan(file);
  };

  /** Re-plans the same file with the settings now in the form; resolves true when the dry-run is ready. */
  const applySettings = async (): Promise<boolean> => {
    const file = sourceFile.current;
    if (!file) return false;
    if (!(await form.trigger())) return false;
    const planned = await plan(file);
    if (!planned) {
      toast({ variant: 'error', description: 'The file could not be planned with these settings.' });
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

  /**
   * Fetches the photos the preset kept as source URLs and stores them as the
   * seller's own media, then writes the uploaded records onto the planned rows.
   * Listings that already hold media are skipped, so a resume never uploads
   * twice. Resolves false when the run was cancelled (the dialog closed).
   */
  const runImagePhase = async (): Promise<boolean> => {
    if (!sellerPubky || !manifestId) return false;
    const targets = await CommerceController.inventoryImportImageTargets(sellerPubky, manifestId);
    if (targets.length === 0) return true;
    const urls = uniqueImageUrls(targets);
    const controller = new AbortController();
    imageRun.current = controller;
    setProgressPhase('photos');
    setProgress({ done: 0, total: urls.length });
    try {
      // A listing whose photos are unchanged has nothing to fetch; it only keeps its media.
      const outcome =
        urls.length === 0
          ? { results: [] }
          : await uploadImportImages({
              ownerPubky: sellerPubky,
              urls,
              altText: (url) => altTextForUrl(targets, url),
              signal: controller.signal,
              onProgress: ({ done, total }) => setProgress({ done, total }),
            });
      if (controller.signal.aborted) return false;
      const results: ImportImageResult[] = outcome.results.map((result) => ({
        url: result.url,
        status: result.status,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.media ? { media: JSON.parse(JSON.stringify(result.media)) as PresetJson } : {}),
      }));
      await CommerceController.attachInventoryImportImages(
        sellerPubky,
        manifestId,
        outcomesFromResults(targets, results),
      );
    } catch {
      toast({
        variant: 'error',
        description: 'Some photos could not be saved. Listings without photos are not published.',
      });
    } finally {
      if (imageRun.current === controller) imageRun.current = null;
    }
    return !controller.signal.aborted;
  };

  const publish = async () => {
    if (!sellerPubky || !manifestId) return;
    setBusy(true);
    setScene('progress');
    setStep(5);
    if (!(await runImagePhase())) return;
    setProgressPhase('listings');
    setProgress({ done: 0, total: counts ? counts.create + counts.update + counts.end : 0 });
    const result = await CommerceController.publishInventoryImport(sellerPubky, manifestId);
    setBusy(false);
    applyPublishResult(result);
  };

  const resume = async () => {
    if (!sellerPubky || !manifestId) return;
    setBusy(true);
    setScene('progress');
    if (!(await runImagePhase())) return;
    setProgressPhase('listings');
    const result = await CommerceController.resumeInventoryImport(sellerPubky, manifestId);
    setBusy(false);
    applyPublishResult(result);
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
    applyPublishResult(result);
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
    busy,
    format,
    lossSummary: lossReport ? summarizeLossReport(lossReport) : undefined,
    form,
    currencyOptions: IMPORT_CURRENCY_OPTIONS,
    conditionOptions: IMPORT_CONDITION_OPTIONS,
    reset,
    planFile,
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
