// Browser steps the release proof scripts share for the Shop's grant sign-in: choosing a signer's QR, copying its
// link, waiting for the grant record, and playing the signer for the marketplace "Enable purchases" and
// "Enable selling" approvals. Auth links and relay secrets are never logged or returned.
import { inspectGrantLink, MARKETPLACE_GRANTS } from './grant-links.mjs';
import { prefix, repoRequire } from './seats.mjs';

const { Pubky } = repoRequire('@synonymdev/pubky');

export const MARKETPLACE_SESSION_KEY = 'pubky.marketplace.session.v1';
export const QR_LABELS = { ring: 'Copy authentication link', bitkit: 'Copy Bitkit authentication link' };

// Where the Shop asks for the marketplace session: an "Enable purchases/selling" card or button, or a dialog that is
// already open.
const MARKETPLACE_TRIGGER = /^(Authorize|Enable purchases|Enable selling|Approve in your Pubky signer)$/;
const MARKETPLACE_DIALOG = /Enable (purchases|selling|device sync|messages)/;

export async function copyQrUrl(page, label, timeout = 20_000) {
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.getByRole('button', { name: label }).first().click();
  const handle = await page.waitForFunction(
    async () => {
      const text = await navigator.clipboard.readText();
      return text.startsWith('pubkyauth://') ? text : null;
    },
    null,
    { timeout },
  );
  return await handle.jsonValue();
}

// A grant sign-in is complete when the auth store holds the saved grant's record id and no cookie export.
export const signedInWithGrant = (page, expected, timeout = 180_000) =>
  page.waitForFunction(
    (wanted) => {
      const raw = localStorage.getItem('shop-auth-store') ?? localStorage.getItem('auth-store');
      const state = raw ? (JSON.parse(raw).state ?? {}) : {};
      return (
        state.currentUserPubky === wanted &&
        typeof state.grantSessionRecordId === 'string' &&
        state.grantSessionRecordId.length > 0 &&
        (state.sessionExport ?? null) === null
      );
    },
    expected,
    { timeout },
  );

// The sign-in card shows one signer's QR at a time; both flows are live from page load.
export async function showSigner(page, signer) {
  const toggle = page.getByRole('radio', { name: signer === 'ring' ? 'Pubky Ring' : 'Bitkit' });
  await toggle.waitFor({ state: 'visible', timeout: 180_000 });
  // A click before the page hydrates does nothing, so click again until the signer is selected.
  for (let attempt = 0; attempt < 12 && (await toggle.getAttribute('aria-checked')) !== 'true'; attempt += 1) {
    await toggle.click();
    await page.waitForTimeout(1000);
  }
  await page.waitForFunction(
    (label) => {
      const el = document.querySelector(`[aria-label="${label}"]`);
      return Boolean(el && !el.disabled && el.querySelector('[data-testid="qr-auth-url"]'));
    },
    QR_LABELS[signer],
    { timeout: 180_000 },
  );
  return await page.getByRole('button', { name: QR_LABELS[signer] }).first().isVisible();
}

const marketplaceSessionFor = (page, owner) =>
  page.evaluate(
    ([key, wanted]) => {
      try {
        return JSON.parse(localStorage.getItem(key) ?? 'null')?.pubky === wanted;
      } catch {
        return false;
      }
    },
    [MARKETPLACE_SESSION_KEY, owner],
  );

/**
 * Signing in does not mint a marketplace session: the Shop asks for it when a signed-in user buys, opens Orders or
 * sells. This plays the signer for that approval, after its link is checked to ask for the marketplace grant and
 * nothing more. Returns false when no approval was asked for within `settleMs` (the seat already has its
 * marketplace session, or the page needs none).
 */
export async function approveMarketplaceAccess(
  page,
  keypair,
  { settleMs = 6000, clientId = null, log = () => {}, onApproved = () => {} } = {},
) {
  const owner = keypair.publicKey.z32();
  const dialog = page.getByRole('dialog', { name: MARKETPLACE_DIALOG });
  const trigger = page.getByRole('button', { name: MARKETPLACE_TRIGGER }).first();
  const deadline = Date.now() + settleMs;
  while (Date.now() < deadline) {
    if (await marketplaceSessionFor(page, owner)) return false;
    if (await dialog.isVisible().catch(() => false)) break;
    if (await trigger.isVisible().catch(() => false)) {
      await trigger.click();
      await dialog.waitFor({ state: 'visible', timeout: 15_000 });
      break;
    }
    await page.waitForTimeout(250);
  }
  if (!(await dialog.isVisible().catch(() => false))) return false;
  const title = (
    (await dialog
      .getByRole('heading')
      .first()
      .innerText()
      .catch(() => '')) || 'marketplace approval'
  )
    .replace(/\s+/g, ' ')
    .trim();
  await dialog.locator('[data-testid="qr-auth-url"]').first().waitFor({ state: 'attached', timeout: 120_000 });
  const url = await copyQrUrl(page, 'Copy authorization link');
  const inspected = inspectGrantLink(url, { clientId, capabilitySets: MARKETPLACE_GRANTS });
  if (inspected.problems.length > 0) {
    throw new Error(`"${title}" link is not the marketplace grant: ${inspected.problems.join('; ')}`);
  }
  await new Pubky().signer(keypair).approveAuthRequest(url);
  log(
    `marketplace: approved "${title}" as ${prefix(owner)} (client ${inspected.clientId}, ${inspected.capabilities.length} caps)`,
  );
  await page.waitForFunction(
    ([key, wanted]) => {
      try {
        return JSON.parse(localStorage.getItem(key) ?? 'null')?.pubky === wanted;
      } catch {
        return false;
      }
    },
    [MARKETPLACE_SESSION_KEY, owner],
    { timeout: 180_000 },
  );
  await dialog.waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});
  onApproved({ title, seat: prefix(owner), clientId: inspected.clientId });
  return true;
}
