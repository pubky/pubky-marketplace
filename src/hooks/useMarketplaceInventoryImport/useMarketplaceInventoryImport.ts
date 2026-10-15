'use client';

import { useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { CommerceController } from '@/controllers/commerce/commerce';
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
import {
  IMPORT_CONDITION_OPTIONS,
  IMPORT_CURRENCY_OPTIONS,
  type ImportSettingsFormData,
  importSettingsFormDefaults,
  importSettingsFormSchema,
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
  const sourceFile = useRef<File | null>(null);

  const form = useForm<ImportSettingsFormData>({
    resolver: zodResolver(importSettingsFormSchema),
    defaultValues: importSettingsFormDefaults,
    mode: 'onChange',
  });

  const reset = () => {
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
    form.reset(importSettingsFormDefaults);
  };

  const plan = async (file: File): Promise<boolean> => {
    if (!sellerPubky) return false;
    setBusy(true);
    setFileName(file.name);
    setScene('validation');
    setStep(2);
    const result = await CommerceController.planInventoryImport(sellerPubky, file, toImportSettings(form.getValues()));
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
    setConflictListingId(null);
    setScene(result.counts.conflict > 0 ? 'conflict' : 'dry-run');
    setStep(result.counts.conflict > 0 ? 5 : 4);
    return true;
  };

  const planFile = async (file: File) => {
    sourceFile.current = file;
    setFormat(undefined);
    setLossReport(undefined);
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

  const publish = async () => {
    if (!sellerPubky || !manifestId) return;
    setBusy(true);
    setScene('progress');
    setStep(5);
    setProgress({ done: 0, total: counts ? counts.create + counts.update + counts.end : 0 });
    const result = await CommerceController.publishInventoryImport(sellerPubky, manifestId);
    setBusy(false);
    applyPublishResult(result);
  };

  const resume = async () => {
    if (!sellerPubky || !manifestId) return;
    setBusy(true);
    setScene('progress');
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

  return {
    scene,
    step,
    fileName,
    message,
    counts,
    progress,
    busy,
    format,
    lossSummary: lossReport ? summarizeLossReport(lossReport) : undefined,
    form,
    currencyOptions: IMPORT_CURRENCY_OPTIONS,
    conditionOptions: IMPORT_CONDITION_OPTIONS,
    reset,
    planFile,
    applySettings,
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
