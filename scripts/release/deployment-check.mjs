// Reads what an origin serves about its own build and checks it against EXPECTED_DPL and/or EXPECTED_COMMIT.
// The page names a Vercel deployment id (`dpl_…`); `GET /api/build` names the commit and works on any host. The build
// URL carries the Shop's mount path like every other route, so for the embedded build PROOF_ORIGIN is
// `https://<app origin>/shop-embed` and the check reads `/shop-embed/api/build`.
import { deploymentIdentityRefusal, extractDpl, parseBuildCommit } from './digital-proof.mjs';

const TIMEOUT_MS = 30_000;

async function body(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return response.ok ? await response.text() : '';
  } catch {
    return '';
  }
}

export async function servedDeployment({ pageUrl, buildUrl, env = process.env, fetchImpl = fetch }) {
  const wantsDpl = Boolean(String(env.EXPECTED_DPL ?? '').trim());
  const wantsCommit = Boolean(String(env.EXPECTED_COMMIT ?? '').trim());
  const dpl = wantsDpl ? extractDpl(await body(pageUrl, fetchImpl)) : null;
  const commit = wantsCommit ? parseBuildCommit(await body(buildUrl, fetchImpl)) : null;
  const found = [wantsDpl && (dpl ?? 'no deployment id'), wantsCommit && (commit ?? 'no commit')]
    .filter(Boolean)
    .join(' ');
  return { dpl, commit, found, refusal: deploymentIdentityRefusal({ dpl, commit }, env) };
}
