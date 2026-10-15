// @vitest-environment node
import { Keypair } from '@synonymdev/pubky';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from '@/config/app';
import { capabilityList, inspectGrantLink, MARKETPLACE_GRANT, MARKETPLACE_GRANTS } from './grant-links.mjs';

const RELAY = 'https://httprelay.pubky.app/inbox';

function grantLink({
  caps = CAPABILITIES,
  cid = 'shop.pubky.app',
  host = 'signin_grant',
  extra = '',
}: { caps?: string; cid?: string; host?: string; extra?: string } = {}) {
  const secret = Buffer.from(new Uint8Array(32).fill(7)).toString('base64url');
  const cpk = Keypair.random().publicKey.z32();
  return (
    `pubkyauth://${host}?caps=${encodeURIComponent(caps)}&relay=${encodeURIComponent(RELAY)}` +
    `&secret=${secret}&cid=${encodeURIComponent(cid)}&cpk=${cpk}${extra}`
  );
}

describe('the Shop sign-in link', () => {
  it('is accepted with the Shop client id and its five capabilities', () => {
    const result = inspectGrantLink(grantLink(), { clientId: 'shop.pubky.app', capabilitySets: [CAPABILITIES] });
    expect(result.problems).toEqual([]);
    expect(result.capabilities).toHaveLength(5);
    expect(result.clientId).toBe('shop.pubky.app');
  });

  it('is accepted with the capabilities in another order', () => {
    const reversed = CAPABILITIES.split(',').reverse().join(',');
    const result = inspectGrantLink(grantLink({ caps: reversed }), {
      clientId: 'shop.pubky.app',
      capabilitySets: [CAPABILITIES],
    });
    expect(result.problems).toEqual([]);
  });

  it('is refused when a capability is missing, extra or different', () => {
    const missing = CAPABILITIES.split(',').slice(1).join(',');
    const extra = `${CAPABILITIES},/pub/other/:rw`;
    const swapped = CAPABILITIES.replace('/priv/chat/v0/:rw', '/priv/chat/v0/:r');
    for (const caps of [missing, extra, swapped]) {
      const result = inspectGrantLink(grantLink({ caps }), {
        clientId: 'shop.pubky.app',
        capabilitySets: [CAPABILITIES],
      });
      expect(result.problems.join(' ')).toContain('not the expected set');
    }
  });

  it('is refused for another client id', () => {
    const result = inspectGrantLink(grantLink({ cid: 'pubky.app' }), {
      clientId: 'shop.pubky.app',
      capabilitySets: [CAPABILITIES],
    });
    expect(result.problems).toEqual(['client id is pubky.app']);
  });

  it('is refused when it carries an extra parameter', () => {
    const result = inspectGrantLink(grantLink({ extra: '&unexpected=1' }), {
      clientId: 'shop.pubky.app',
      capabilitySets: [CAPABILITIES],
    });
    expect(result.problems).toEqual(['parameters are caps,cid,cpk,relay,secret,unexpected']);
  });

  it('is refused when it is the old cookie sign-in link', () => {
    const cookie = `pubkyauth://signin?caps=${encodeURIComponent(CAPABILITIES)}&relay=${encodeURIComponent(RELAY)}&secret=abc`;
    const result = inspectGrantLink(cookie, { clientId: 'shop.pubky.app', capabilitySets: [CAPABILITIES] });
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain('not a signin_grant link');
  });

  it('never repeats the link or its relay secret in a problem', () => {
    const url = grantLink({ caps: '/pub/other/:rw', cid: 'someone.else' });
    const secret = new URL(url).searchParams.get('secret') as string;
    const result = inspectGrantLink(url, { clientId: 'shop.pubky.app', capabilitySets: [CAPABILITIES] });
    expect(result.problems.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('pubkyauth://');
  });
});

describe('a marketplace approval link', () => {
  it('accepts either marketplace grant with any non-empty client id', () => {
    for (const caps of MARKETPLACE_GRANTS) {
      const result = inspectGrantLink(grantLink({ caps, cid: 'marketplace.staging.shop.pubky.app' }), {
        capabilitySets: MARKETPLACE_GRANTS,
      });
      expect(result.problems).toEqual([]);
    }
  });

  it('refuses a request for more than the marketplace grant', () => {
    const result = inspectGrantLink(grantLink({ caps: `${MARKETPLACE_GRANT},/pub/pubky.app/:rw` }), {
      capabilitySets: MARKETPLACE_GRANTS,
    });
    expect(result.problems.join(' ')).toContain('not the expected set');
  });

  it('checks the client id when one is required', () => {
    const result = inspectGrantLink(grantLink({ caps: MARKETPLACE_GRANT, cid: 'marketplace.shop.pubky.app' }), {
      clientId: 'marketplace.staging.shop.pubky.app',
      capabilitySets: MARKETPLACE_GRANTS,
    });
    expect(result.problems).toEqual(['client id is marketplace.shop.pubky.app']);
  });
});

describe('capabilityList', () => {
  it('trims, deduplicates and sorts', () => {
    expect(capabilityList(' /b/:rw, /a/:rw,/b/:rw,')).toEqual(['/a/:rw', '/b/:rw']);
    expect(capabilityList('')).toEqual([]);
    expect(capabilityList(null)).toEqual([]);
  });
});
