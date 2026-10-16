import {
  type ConnectorConnection,
  connectorConnectionSchema,
  type ConnectorProvider,
} from '@/libs/commerce/connectors';

const FIXTURE_ID = '11111111-1111-4111-8111-111111111111';
const BASE = 'https://staging-api.pubky.app/v1/connectors';

/** A connection as the service lists it (`GET /v1/connectors`), in the Shop's camelCase, with overrides on top. */
export function connectionFixture(overrides: Record<string, unknown> = {}): ConnectorConnection {
  const provider: ConnectorProvider = overrides.provider === 'shopify' ? 'shopify' : 'woocommerce';
  const id = typeof overrides.id === 'string' ? overrides.id : FIXTURE_ID;
  const urls =
    provider === 'shopify'
      ? {
          launch: `${BASE}/shopify/c/${id}/launch`,
          oauthCallback: `${BASE}/shopify/c/${id}/oauth/callback`,
          webhooks: `${BASE}/shopify/c/${id}/webhooks`,
        }
      : { oauthCallback: `${BASE}/woocommerce/oauth/callback`, webhooks: `${BASE}/webhooks/woocommerce` };
  return connectorConnectionSchema.parse({
    id,
    provider,
    domain: provider === 'shopify' ? 'your-store.myshopify.com' : 'dezentralshop.ch',
    appKind: provider === 'shopify' ? 'custom' : 'none',
    status: 'connected',
    scopes: [],
    missingScopes: [],
    credentialsSaved: provider === 'shopify',
    urls,
    ...overrides,
  });
}
