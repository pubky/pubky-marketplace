/** Exercise the Shop's own visible sign-out action. The App has a separate session on a shared origin. */
export async function signOutThroughShopSettings(page, settingsUrl) {
  await page.goto(settingsUrl, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  const button = page.locator('#sign-out-btn');
  await button.waitFor({ state: 'visible', timeout: 60_000 });
  await button.click();
  await page.waitForFunction(
    () => {
      const raw = localStorage.getItem('shop-auth-store');
      const state = raw ? JSON.parse(raw).state : null;
      return !state?.currentUserPubky && !state?.grantSessionRecordId && !state?.sessionExport;
    },
    null,
    { timeout: 120_000 },
  );
  return true;
}
