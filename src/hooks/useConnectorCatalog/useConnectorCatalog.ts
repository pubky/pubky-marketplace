'use client';

import { useEffect, useRef, useState } from 'react';
import { ConnectorsController } from '@/controllers/connectors/connectors';
import {
  type ConnectorCatalogProduct,
  type ConnectorConnection,
  connectorErrorMessage,
} from '@/libs/commerce/connectors';
import { isMarketplaceSessionRequiredError } from '@/libs/error/error.utils';
import { toast } from '@/molecules/Toaster/toast';
import { productMatchesSearch } from '@/pipes/commerce/connector-catalog-search';
import { useCommerceStore } from '@/stores/commerce/commerce.store';

/** A catalog this big is paged in full so that search and "select all" see every product. */
const MAX_CATALOG_PAGES = 100;
const LOAD_FAILED = 'The store catalog could not be loaded. Check the connection and try again.';
const LOAD_MORE_FAILED = 'The rest of the products could not be loaded yet.';

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/**
 * The store's products with the seller's "Also publish on Pubky" choice. The
 * choice is kept on the service as a whole set and is only written by `save`.
 * Products that already have a published listing stay selected: the service
 * refuses to drop them.
 */
export function useConnectorCatalog(connection: Pick<ConnectorConnection, 'id'> | null) {
  const connectionId = connection?.id ?? null;
  const marketplaceSession = useCommerceStore((state) => state.marketplaceSession);
  const [products, setProducts] = useState<ConnectorCatalogProduct[]>([]);
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [mapped, setMapped] = useState<ReadonlySet<string>>(new Set());
  const [isLoadingFirstPage, setIsLoading] = useState(true);
  const isLoading = connectionId !== null && isLoadingFirstPage;
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSession, setNeedsSession] = useState(false);
  const [search, setSearch] = useState('');
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const resumeFrom = useRef<string | null>(null);
  const loadedRef = useRef<ConnectorCatalogProduct[]>([]);
  const run = useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null });

  /** Starts a read of the catalog and ends any read still going, so a late page never lands on a newer one. */
  const beginRun = () => {
    run.current.controller?.abort();
    const controller = new AbortController();
    const id = run.current.id + 1;
    run.current = { id, controller };
    return { signal: controller.signal, isCurrent: () => run.current.id === id };
  };

  const endRuns = () => {
    run.current.controller?.abort();
    run.current = { id: run.current.id + 1, controller: null };
  };

  /** Reads catalog pages from `startPage` on; products already shown stay when a later page fails. */
  const loadPages = async (id: string, startPage: string | null, isCurrent: () => boolean, signal: AbortSignal) => {
    let page = startPage;
    let answered = startPage !== null;
    setLoadMoreError(null);
    resumeFrom.current = null;
    try {
      for (let index = 0; index < MAX_CATALOG_PAGES; index += 1) {
        const next = await ConnectorsController.fetchCatalogPage(id, { page, signal });
        if (!isCurrent()) return;
        const first = !answered;
        answered = true;
        loadedRef.current = [...loadedRef.current, ...next.products];
        setProducts(loadedRef.current);
        if (first) {
          setIsLoading(false);
          setIsLoadingMore(Boolean(next.nextPage));
        }
        if (!next.nextPage) return;
        page = next.nextPage;
      }
    } catch (pageError) {
      if (!isCurrent()) return;
      if (!answered) throw pageError;
      resumeFrom.current = page;
      setLoadMoreError(connectorErrorMessage(pageError, LOAD_MORE_FAILED));
    }
  };

  const load = async () => {
    if (!connectionId) return;
    const { isCurrent, signal } = beginRun();
    loadedRef.current = [];
    setIsLoading(true);
    setIsLoadingMore(false);
    setError(null);
    setLoadMoreError(null);
    try {
      const [selection, mappings] = await Promise.all([
        ConnectorsController.fetchSelection(connectionId),
        ConnectorsController.fetchMappings(connectionId),
      ]);
      if (!isCurrent()) return;
      const selectedSet = new Set(selection);
      setSaved(selectedSet);
      setChosen(selectedSet);
      setMapped(new Set(mappings.map((mapping) => mapping.providerProductId)));
      await loadPages(connectionId, null, isCurrent, signal);
    } catch (loadError) {
      if (!isCurrent()) return;
      setNeedsSession(isMarketplaceSessionRequiredError(loadError));
      setError(connectorErrorMessage(loadError, LOAD_FAILED));
    } finally {
      if (isCurrent()) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  };

  /** Carries on from the page that failed, keeping the products already shown. */
  const resumeLoading = async () => {
    const from = resumeFrom.current;
    if (!connectionId || from === null) return;
    const { isCurrent, signal } = beginRun();
    setIsLoadingMore(true);
    try {
      await loadPages(connectionId, from, isCurrent, signal);
    } finally {
      if (isCurrent()) setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    void load();
    return endRuns;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, marketplaceSession]);

  const visible = products.filter((product) => productMatchesSearch(product, search));
  const isLocked = (productId: string) => mapped.has(productId);

  const toggle = (productId: string) => {
    if (isLocked(productId)) return;
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const selectVisible = () => {
    setChosen((current) => new Set([...current, ...visible.map((product) => product.providerProductId)]));
  };

  const clearVisible = () => {
    setChosen((current) => {
      const next = new Set(current);
      for (const product of visible) if (!isLocked(product.providerProductId)) next.delete(product.providerProductId);
      return next;
    });
  };

  const save = async (): Promise<boolean> => {
    if (!connectionId) return false;
    setIsSaving(true);
    try {
      const next = await ConnectorsController.commitSelection(connectionId, [...chosen]);
      const nextSet = new Set(next);
      setSaved(nextSet);
      setChosen(nextSet);
      toast({ description: 'Your choice is saved.' });
      return true;
    } catch (saveError) {
      toast({
        variant: 'error',
        title: 'Could not save your choice',
        description: connectorErrorMessage(saveError, 'Try again in a moment.'),
      });
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  return {
    products,
    visible,
    chosen,
    saved,
    mapped,
    isLoading,
    isLoadingMore,
    isSaving,
    error,
    loadMoreError,
    resumeLoading,
    needsSession,
    search,
    setSearch,
    isLocked,
    toggle,
    selectVisible,
    clearVisible,
    save,
    dirty: !sameSet(saved, chosen),
    chosenCount: chosen.size,
    reload: load,
  };
}
