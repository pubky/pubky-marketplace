import { create } from 'zustand';

export type ClientRegionStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface ClientRegionStore {
  status: ClientRegionStatus;
  /** The visitor's IP country (uppercase alpha-2) once read; null when the edge could not tell. */
  country: string | null;
  markLoading: () => void;
  markReady: (country: string | null) => void;
  markFailed: () => void;
}

/**
 * The visitor's IP country as the Shop's own `/api/marketplace/client-region` route reports it.
 * Memory only: it describes where this page load is coming from, so it is read afresh each load.
 */
export const useClientRegionStore = create<ClientRegionStore>()((set) => ({
  status: 'idle',
  country: null,
  markLoading: () => set({ status: 'loading' }),
  markReady: (country) => set({ status: 'ready', country }),
  markFailed: () => set({ status: 'failed', country: null }),
}));
