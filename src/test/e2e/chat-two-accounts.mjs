/**
 * Two-account live proof of buyer↔seller chat against a local Pubky testnet.
 *
 * Needs: the Shop dev server (see .claude/launch.json "shop-testnet"), the
 * pubky-docker homeserver on :6286/:6288 (admin password "admin"), the local
 * inbox the Shop is configured with (PUBKY_RUNTIME_INBOX_URL), and
 * Playwright's Chromium.
 *
 *   node src/test/e2e/chat-two-accounts.mjs
 *
 * Two browser contexts (Alice, Bob), each signed in through the Shop's grant
 * sign-in link (the Bitkit option) approved by a Node-side signer. Checks:
 * identity key published, a message from Alice reaches Bob's thread, Bob's
 * reply reaches Alice's OPEN thread live, both tabs open an inbox session,
 * with the event stream blocked a message still reaches Bob's inbox list
 * through a ping, history survives a reload, and a fresh browser context
 * rebuilds the conversation from the homeservers. Screenshots land in
 * SCREENSHOT_DIR.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.SHOP_URL ?? 'http://localhost:3000';
const HOMESERVER = process.env.CHAT_E2E_HOMESERVER ?? '8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo';
const ADMIN_URL = process.env.HOMESERVER_ADMIN_URL ?? 'http://localhost:6288/generate_signup_token';
const ADMIN_PASSWORD = process.env.HOMESERVER_ADMIN_PASSWORD ?? 'admin';
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? join(process.cwd(), '.chat-e2e');
const HEADLESS = process.env.HEADED !== '1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sdk = await import('@synonymdev/pubky');
const pubky = sdk.Pubky.testnet();
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function registerIdentity(label) {
  const keypair = sdk.Keypair.random();
  const signer = pubky.signer(keypair);
  const homeserver = sdk.PublicKey.from(HOMESERVER);
  try {
    await signer.signup(homeserver, null);
  } catch {
    const response = await fetch(ADMIN_URL, { headers: { 'X-Admin-Password': ADMIN_PASSWORD } });
    const token = (await response.text()).trim();
    await signer.signup(homeserver, token);
  }
  const id = keypair.publicKey.z32();
  console.log(`${label}: ${id}`);
  return { label, keypair, id };
}

async function readAuthUrl(page) {
  await page.evaluate(() => {
    window.__copied = null;
    const original = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    navigator.clipboard.writeText = async (text) => {
      window.__copied = text;
      try {
        await original?.(text);
      } catch {}
    };
  });
  const slot = page.locator('[data-testid="qr-auth-url"]').first();
  await slot.waitFor({ state: 'attached', timeout: 30_000 });
  await slot.locator('xpath=ancestor::button[1]').click();
  const handle = await page.waitForFunction(
    () => (typeof window.__copied === 'string' && window.__copied.startsWith('pubkyauth://') ? window.__copied : null),
    null,
    { timeout: 10_000 },
  );
  return await handle.jsonValue();
}

async function signIn(context, identity, name) {
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error(`[${identity.label}] pageerror`, String(error)));
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('radio', { name: 'Bitkit' }).click();
  const url = await readAuthUrl(page);
  if (!url.startsWith('pubkyauth://signin_grant')) {
    throw new Error(`[${identity.label}] expected a grant sign-in link, got ${url.slice(0, 40)}`);
  }
  console.log(`[${identity.label}] approving ${url.slice(0, 60)}…`);
  // The local relay occasionally drops the first POST right after a dev-server rebuild; one retry covers it.
  try {
    await pubky.signer(identity.keypair).approveAuthRequest(url);
  } catch (error) {
    console.warn(`[${identity.label}] approval failed once, retrying`, String(error).slice(0, 120));
    await sleep(1_000);
    await pubky.signer(identity.keypair).approveAuthRequest(url);
  }
  console.log(`[${identity.label}] approved`);
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !text.includes('Failed to load resource')) {
      console.error(`[${identity.label}] console.error`, text.slice(0, 200));
    }
    if (message.type() === 'warning' && /chat/iu.test(text))
      console.warn(`[${identity.label}] console.warn`, text.slice(0, 300));
  });
  try {
    await waitForSignedIn(page, identity, name);
    // Chat is set up on the first non-onboarding route after sign-in.
    await page.goto(`${BASE}/messages`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-surface="chat-inbox"]').waitFor({ state: 'visible', timeout: 60_000 });
  } catch (error) {
    const state = await page.evaluate(() => localStorage.getItem('shop-auth-store'));
    console.error(`[${identity.label}] sign-in wait failed at ${page.url()} store=${state}`);
    await snap(page, `fail-signin-${identity.label}`);
    throw error;
  }
  return page;
}

async function waitForSignedIn(page, identity, name) {
  await page.waitForFunction(
    () => {
      try {
        const state = JSON.parse(localStorage.getItem('shop-auth-store') ?? '{}').state ?? {};
        return typeof state.grantSessionRecordId === 'string' && state.grantSessionRecordId.length > 0;
      } catch {
        return false;
      }
    },
    null,
    { timeout: 60_000 },
  );
  await page.waitForFunction(() => !location.pathname.startsWith('/sign-in'), null, { timeout: 60_000 });
  if (page.url().includes('/onboarding/profile')) {
    await page.getByPlaceholder('Enter your name').fill(name);
    await page.getByRole('button', { name: 'Finish' }).click();
    // The profile step records hasProfile; where it goes next depends on the stored return path.
    await page.waitForFunction(
      () => {
        try {
          return JSON.parse(localStorage.getItem('shop-auth-store') ?? '{}').state?.hasProfile === true;
        } catch {
          return false;
        }
      },
      null,
      { timeout: 60_000 },
    );
  }
}

async function readPublic(url) {
  try {
    const response = await pubky.publicStorage.get(url);
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

async function listPublic(url) {
  try {
    return await pubky.publicStorage.list(url, null, false, 500, false);
  } catch {
    return [];
  }
}

async function publicKeyPublished(id) {
  return (await readPublic(`pubky://${id}/pub/chat/v0/key.json`)) !== null;
}

async function sendMessage(page, body) {
  const composer = page.locator('#chat-composer-body');
  await composer.waitFor({ state: 'visible', timeout: 30_000 });
  await composer.fill(body);
  await composer.press('Enter');
}

function messageWithText(page, text) {
  return page.locator('[data-testid="chat-message"]', { hasText: text });
}

async function waitForSent(page, text, timeout = 30_000) {
  await messageWithText(page, text).first().waitFor({ state: 'visible', timeout });
  await page.waitForFunction(
    (needle) =>
      [...document.querySelectorAll('[data-testid="chat-message"]')].some(
        (node) => node.textContent?.includes(needle) && node.getAttribute('data-status') === 'sent',
      ),
    text,
    { timeout },
  );
}

async function dumpRows(page, label) {
  try {
    const rows = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const request = indexedDB.open('shop-franky');
          request.onsuccess = () => {
            const store = request.result.transaction('chat_messages').objectStore('chat_messages');
            const all = store.getAll();
            all.onsuccess = () =>
              resolve(
                all.result.map((row) => [
                  row.direction,
                  row.status,
                  row.last_error,
                  row.file_name,
                  row.body.slice(0, 16),
                ]),
              );
          };
          request.onerror = () => resolve('open failed');
        }),
    );
    console.error(`[${label}] rows`, JSON.stringify(rows));
  } catch (error) {
    console.error(`[${label}] rows dump failed`, String(error));
  }
}

async function snap(page, name) {
  await page.screenshot({ path: join(SCREENSHOT_DIR, `${name}.png`), fullPage: false });
}

const browser = await chromium.launch({
  headless: HEADLESS,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  // A locally installed Chromium when Playwright cannot download its own (e.g. unsupported distro).
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
const makeContext = () =>
  browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });

try {
  const alice = await registerIdentity('alice');
  const bob = await registerIdentity('bob');
  const aliceContext = await makeContext();
  const bobContext = await makeContext();
  const alicePage = await signIn(aliceContext, alice, 'Alice Seller');
  record('alice:signed-in', true, alicePage.url());
  const bobPage = await signIn(bobContext, bob, 'Bob Buyer');
  record('bob:signed-in', true, bobPage.url());

  // Identity keys are provisioned right after sign-in.
  let keysOk = false;
  for (let attempt = 0; attempt < 30 && !keysOk; attempt += 1) {
    keysOk = (await publicKeyPublished(alice.id)) && (await publicKeyPublished(bob.id));
    if (!keysOk) await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  record('keys:published', keysOk);

  // Alice (seller) opens the thread with Bob from a listing context and writes.
  await alicePage.goto(`${BASE}/messages/${bob.id}?listing=boots`, { waitUntil: 'domcontentloaded' });
  await sendMessage(alicePage, 'Hi Bob, the boots are still available.');
  await waitForSent(alicePage, 'Hi Bob');
  record('alice:first-message-sent', true);
  await snap(alicePage, '01-alice-thread-after-send');

  // Bob opens the thread (a listing or order entry point) and sees it.
  const bobOpenedAt = Date.now();
  await bobPage.goto(`${BASE}/messages/${alice.id}`, { waitUntil: 'domcontentloaded' });
  await messageWithText(bobPage, 'Hi Bob').first().waitFor({ state: 'visible', timeout: 30_000 });
  record('bob:receives-first-message', true, `${Date.now() - bobOpenedAt} ms after opening`);
  await snap(bobPage, '02-bob-thread-received');

  // Bob replies; Alice's OPEN thread must update live.
  const replyAt = Date.now();
  await sendMessage(bobPage, 'Great, I will take them.');
  await waitForSent(bobPage, 'I will take them');
  await messageWithText(alicePage, 'I will take them').first().waitFor({ state: 'visible', timeout: 30_000 });
  record('alice:live-reply', true, `${Date.now() - replyAt} ms end to end`);
  await snap(alicePage, '03-alice-thread-live-reply');
  const order = await alicePage.evaluate(async () => {
    const dom = [...document.querySelectorAll('[data-testid="chat-message"]')].map(
      (node) => `${node.getAttribute('data-direction')}:${node.textContent?.slice(0, 20)}`,
    );
    const rows = await new Promise((resolve) => {
      const request = indexedDB.open('shop-franky');
      request.onsuccess = () => {
        const db = request.result;
        const store = db.transaction('chat_messages').objectStore('chat_messages');
        const all = store.getAll();
        all.onsuccess = () =>
          resolve(all.result.map((row) => [row.direction, row.file_name, row.sent_at, row.body.slice(0, 12)]));
      };
    });
    return { dom, rows };
  });
  console.log('alice order', JSON.stringify(order));
  record('alice:thread-order', order.dom[0]?.startsWith('sent:'), order.dom.join(' | '));

  // A second reply while Alice is on the inbox list: unread badge appears.
  await alicePage.goto(`${BASE}/messages`, { waitUntil: 'domcontentloaded' });
  await sendMessage(bobPage, 'Can you ship to Lisbon?');
  await waitForSent(bobPage, 'Lisbon');
  await alicePage
    .locator('[data-testid="chat-conversation-unread"]')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });
  record('alice:inbox-unread-badge', true);
  await snap(alicePage, '04-alice-inbox-unread');

  // Opening the thread clears the unread badge.
  await alicePage.locator('[data-testid="chat-conversation-row"]').first().click();
  await messageWithText(alicePage, 'Lisbon').first().waitFor({ state: 'visible', timeout: 30_000 });
  await alicePage.goto(`${BASE}/messages`, { waitUntil: 'domcontentloaded' });
  await alicePage
    .locator('[data-testid="chat-conversation-row"]')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });
  const unreadAfterRead = await alicePage.locator('[data-testid="chat-conversation-unread"]').count();
  record('alice:read-clears-badge', unreadAfterRead === 0, `badges: ${unreadAfterRead}`);

  {
    // A grant session yields an inbox PoP: both tabs hold an inbox bearer.
    const hasInboxSession = (page) =>
      page.evaluate(() => Object.keys(localStorage).some((key) => key.includes('chat-inbox-session')));
    let sessions = false;
    for (let attempt = 0; attempt < 30 && !sessions; attempt += 1) {
      sessions = (await hasInboxSession(alicePage)) && (await hasInboxSession(bobPage));
      if (!sessions) await sleep(1_000);
    }
    record('inbox:sessions', sessions);

    // Ping path: Bob sits on the inbox list (no open-thread poll) with the homeserver event stream
    // blocked. Reconciliation runs every 60 s, so a delivery within 30 s can only come from a ping.
    await bobContext.route('**/events-stream**', (route) => route.abort());
    const bobPings = [];
    const bobAcks = [];
    const alicePings = [];
    const onBobResponse = async (response) => {
      const url = response.url();
      if (url.includes('/v1/pings?')) {
        const body = await response.json().catch(() => null);
        if (Array.isArray(body?.pings)) bobPings.push(...body.pings);
      } else if (url.includes('/v1/pings/ack')) {
        bobAcks.push(response.status());
      }
    };
    const onAliceResponse = (response) => {
      if (response.request().method() === 'POST' && response.url().endsWith('/v1/pings')) {
        alicePings.push(response.status());
      }
    };
    bobPage.on('response', onBobResponse);
    alicePage.on('response', onAliceResponse);
    await bobPage.goto(`${BASE}/messages`, { waitUntil: 'domcontentloaded' });
    await bobPage.locator('[data-surface="chat-inbox"]').waitFor({ state: 'visible', timeout: 60_000 });
    await sleep(3_000);
    const nonce = `ping-${Date.now().toString(36)}`;
    await alicePage.goto(`${BASE}/messages/${bob.id}`, { waitUntil: 'domcontentloaded' });
    const pingAt = Date.now();
    await sendMessage(alicePage, `Ping check ${nonce}`);
    await waitForSent(alicePage, nonce);
    let pingDelivered = true;
    try {
      await bobPage
        .locator('[data-testid="chat-conversation-row"]', { hasText: nonce })
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 });
    } catch {
      pingDelivered = false;
    }
    // The ack follows the sync that produced the row; give it a moment.
    for (let attempt = 0; attempt < 10 && bobAcks.length === 0; attempt += 1) await sleep(500);
    record(
      'inbox:ping-delivers-without-sse',
      pingDelivered,
      `${Date.now() - pingAt} ms; alice POST /v1/pings → ${alicePings.join(',') || 'none'}; bob pings ${bobPings.length}; acks → ${bobAcks.join(',') || 'none'}`,
    );
    record(
      'inbox:ping-posted-received-acked',
      alicePings.some((status) => status >= 200 && status < 300) &&
        bobPings.some((ping) => ping.sender === alice.id) &&
        bobAcks.some((status) => status >= 200 && status < 300),
    );
    await snap(bobPage, '04b-bob-inbox-ping-delivery');
    bobPage.off('response', onBobResponse);
    alicePage.off('response', onAliceResponse);
    await bobContext.unroute('**/events-stream**');
  }

  // Reload keeps history.
  await alicePage.goto(`${BASE}/messages/${bob.id}`, { waitUntil: 'domcontentloaded' });
  await alicePage.reload({ waitUntil: 'domcontentloaded' });
  await messageWithText(alicePage, 'Lisbon').first().waitFor({ state: 'visible', timeout: 30_000 });
  const countAfterReload = await alicePage.locator('[data-testid="chat-message"]').count();
  record('alice:history-survives-reload', countAfterReload >= 3, `${countAfterReload} messages`);

  // A fresh browser context (new device) rebuilds everything from the homeservers.
  const aliceConversations = await alicePage.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open('shop-franky');
        request.onsuccess = () => {
          const all = request.result.transaction('chat_conversations').objectStore('chat_conversations').getAll();
          all.onsuccess = () =>
            resolve(
              all.result.map((row) => ({
                peer: row.peer_pubky.slice(0, 6),
                folder: row.folder_id?.slice(0, 6),
                kid: row.peer_key_id,
                dirty: row.priv_state_dirty,
                state: row.peer_state,
              })),
            );
        };
      }),
  );
  console.log('[alice] conversations before device two', JSON.stringify(aliceConversations));
  try {
    const nodeSession = await pubky.signer(alice.keypair).signinCookie();
    const privList = await nodeSession.storage.list('/priv/chat/v0/conversations/', null, false, 100, false);
    const privKey = await nodeSession.storage.get('/priv/chat/v0/key.json');
    const privKeyJson = privKey.ok ? await privKey.json() : null;
    console.log('[alice] homeserver /priv conversations', privList.length, 'key kid', privKeyJson?.kid);
  } catch (error) {
    console.error('[alice] node /priv probe failed', String(error).slice(0, 200));
  }
  const deviceTwo = await makeContext();
  const alicePageTwo = await signIn(deviceTwo, alice, 'Alice Seller');
  alicePageTwo.on('console', (message) => {
    if (message.text().includes('Chat') || message.text().includes('chat'))
      console.log('[alice-2] console', message.text().slice(0, 300));
  });
  await alicePageTwo.goto(`${BASE}/messages`, { waitUntil: 'domcontentloaded' });
  try {
    await alicePageTwo
      .locator('[data-testid="chat-conversation-row"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });
  } catch (error) {
    const diag = await alicePageTwo.evaluate(
      () =>
        new Promise((resolve) => {
          const request = indexedDB.open('shop-franky');
          request.onsuccess = () => {
            const tx = request.result.transaction(['chat_conversations', 'chat_identity', 'chat_sync_state']);
            const out = {};
            for (const name of ['chat_conversations', 'chat_identity', 'chat_sync_state']) {
              tx.objectStore(name).getAll().onsuccess = (event) => {
                out[name] = event.target.result.map((row) => ({
                  ...row,
                  secret_key: undefined,
                  public_key: undefined,
                }));
              };
            }
            tx.oncomplete = () => resolve(out);
          };
        }),
    );
    console.error('[alice-2] diag', JSON.stringify(diag).slice(0, 1500));
    throw error;
  }
  await alicePageTwo.locator('[data-testid="chat-conversation-row"]').first().click();
  await messageWithText(alicePageTwo, 'Lisbon').first().waitFor({ state: 'visible', timeout: 60_000 });
  await alicePageTwo.waitForTimeout(3_000);
  const countDeviceTwo = await alicePageTwo.locator('[data-testid="chat-message"]').count();
  const deviceTwoOrder = await alicePageTwo.evaluate(() =>
    [...document.querySelectorAll('[data-testid="chat-message"]')].map(
      (node) => `${node.getAttribute('data-direction')}:${node.textContent?.slice(0, 16)}`,
    ),
  );
  record('alice:new-device-rebuild', countDeviceTwo >= 3, `${countDeviceTwo} messages: ${deviceTwoOrder.join(' | ')}`);
  await snap(alicePageTwo, '05-alice-new-device');

  // The homeserver only ever holds ciphertext.
  const aliceKeyJson = JSON.parse((await readPublic(`pubky://${alice.id}/pub/chat/v0/key.json`)) ?? '{}');
  record('homeserver:key-has-no-secret', 'pk' in aliceKeyJson && !('sk' in aliceKeyJson));
  // The homeserver lists deep by default: every message file under /pub/chat/v0/.
  const files = (await listPublic(`pubky://${alice.id}/pub/chat/v0/`)).filter((line) => !line.endsWith('key.json'));
  let plaintextLeak = false;
  for (const fileUrl of files) {
    const body = (await readPublic(fileUrl)) ?? '';
    if (body.includes('boots') || body.includes('Hi Bob')) plaintextLeak = true;
  }
  record('homeserver:messages-are-ciphertext', files.length > 0 && !plaintextLeak, `${files.length} file(s)`);
  // Folder ids are per direction: listing both accounts' chat roots links nothing.
  const folderIdsOf = async (id) =>
    new Set(
      (await pubky.publicStorage.list(`pubky://${id}/pub/chat/v0/`, null, false, 100, true))
        .map((line) => line.split('/pub/chat/v0/')[1]?.replace(/\/$/u, ''))
        .filter((name) => name && name !== 'key.json'),
    );
  const aliceFolders = await folderIdsOf(alice.id);
  const bobFolders = await folderIdsOf(bob.id);
  const shared = [...aliceFolders].filter((folder) => bobFolders.has(folder));
  record(
    'homeserver:folders-differ-per-direction',
    aliceFolders.size > 0 && bobFolders.size > 0 && shared.length === 0,
    `alice ${aliceFolders.size}, bob ${bobFolders.size}, shared ${shared.length}`,
  );
} catch (error) {
  record('run', false, String(error).slice(0, 500));
  for (const context of browser.contexts()) {
    for (const page of context.pages()) await dumpRows(page, page.url());
  }
} finally {
  await browser.close();
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
