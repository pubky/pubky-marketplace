import type { StoreState } from '@/config/store-mode';
import { StoreClaimedView } from '@/molecules/StoreClaim/StoreClaimedView';
import { StoreClaimFlow } from '@/organisms/StoreClaim/StoreClaimFlow';

export function StoreSetup({ state }: { state: Exclude<StoreState, { kind: 'off' }> }) {
  return state.kind === 'claimed' ? <StoreClaimedView seller={state.seller} /> : <StoreClaimFlow />;
}
