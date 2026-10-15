// Grant sign-in links for the release proof scripts: parsing with the SDK and the checks the signers apply.
// Pubky Ring, Bitkit and the Shop's marketplace approvals all show a `pubkyauth://signin_grant` link; the proof
// parses each one with SigninGrantDeepLink and approves it only when it asks for exactly what was expected.
import { repoRequire } from './seats.mjs';

const { SigninGrantDeepLink } = repoRequire('@synonymdev/pubky');

/** What a marketplace purchase or selling approval requests (marketplace-service GRANT_REQUEST_CAPABILITIES). */
export const MARKETPLACE_GRANT = '/pub/pubky.app/marketplace-service/v1/:rw,/priv/pubky.app/:rw';
/** The narrower set a service that has not deployed the wider request still emits. */
export const PREVIOUS_MARKETPLACE_GRANT = '/pub/pubky.app/marketplace-service/v1/:rw';
export const MARKETPLACE_GRANTS = [MARKETPLACE_GRANT, PREVIOUS_MARKETPLACE_GRANT];

// A grant link carries exactly these parameters, each once; `secret` is the relay secret and never leaves this module.
const GRANT_LINK_PARAMETERS = ['caps', 'cid', 'cpk', 'relay', 'secret'];

/** The entries of a comma-separated capability string, trimmed, deduplicated and sorted. */
export const capabilityList = (value) =>
  [
    ...new Set(
      String(value ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ].sort();

const sameList = (a, b) => a.length === b.length && a.every((entry, index) => entry === b[index]);

/**
 * Parses a copied approval link and lists what is wrong with it. `capabilitySets` are the comma-separated
 * capability strings the link may request (order-insensitive, exact set); `clientId` is the client id it must
 * carry, or null to accept any non-empty one. The result never contains the link or its relay secret.
 * @param {string} url
 * @param {{ clientId?: string | null, capabilitySets: string[] }} expected
 * @returns {{ problems: string[], clientId: string | null, capabilities: string[] }}
 */
export function inspectGrantLink(url, { clientId = null, capabilitySets }) {
  const problems = [];
  let parsed;
  let link;
  try {
    parsed = new URL(url);
    link = SigninGrantDeepLink.parse(url);
  } catch (error) {
    return {
      problems: [`not a signin_grant link: ${String(error?.message ?? error).slice(0, 120)}`],
      clientId: null,
      capabilities: [],
    };
  }
  const found = [...new Set(parsed.searchParams.keys())].sort();
  if (parsed.host !== 'signin_grant') problems.push(`host is ${parsed.host}`);
  if (!sameList(found, GRANT_LINK_PARAMETERS) || found.some((key) => parsed.searchParams.getAll(key).length !== 1)) {
    problems.push(`parameters are ${found.join(',')}`);
  }
  const capabilities = capabilityList(link.capabilities);
  if (!capabilitySets.some((set) => sameList(capabilities, capabilityList(set)))) {
    problems.push(`${capabilities.length} capabilities requested, not the expected set`);
  }
  if (!link.clientId) problems.push('no client id');
  else if (clientId && link.clientId !== clientId) problems.push(`client id is ${link.clientId}`);
  return { problems, clientId: link.clientId, capabilities };
}
