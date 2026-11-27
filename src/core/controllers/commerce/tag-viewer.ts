import { readAuthEpoch } from '@/controllers/auth/auth-epoch';
import { captureAuthScope } from '@/controllers/auth/auth-scope';
import { useAuthStore } from '@/stores/auth/auth.store';

/** Community tag rows share a target key, but their relationship and tag URI belong to one viewer. */
export function captureTagViewer(viewerId?: string): () => boolean {
  const scope = captureAuthScope();
  const epoch = readAuthEpoch();
  const session = useAuthStore.getState().session;
  return () => {
    const auth = useAuthStore.getState();
    return (
      !scope.aborted &&
      !auth.isLoggingOut &&
      auth.currentUserPubky === (viewerId ?? null) &&
      auth.session === session &&
      readAuthEpoch() === epoch
    );
  };
}
