import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { STORE_SETUP_PERSIST_KEY } from '../persistedKeys';

export type StoreSetupStore = {
  finishPanelDismissed: boolean;
  dismissFinishPanel: () => void;
  reset: () => void;
};

export const useStoreSetupStore = create<StoreSetupStore>()(
  devtools(
    persist(
      (set) => ({
        finishPanelDismissed: false,
        dismissFinishPanel: () => set({ finishPanelDismissed: true }),
        reset: () => set({ finishPanelDismissed: false }),
      }),
      {
        name: STORE_SETUP_PERSIST_KEY,
        partialize: (state) => ({ finishPanelDismissed: state.finishPanelDismissed }),
      },
    ),
    { name: 'store-setup-store', enabled: process.env.NODE_ENV === 'development' },
  ),
);
