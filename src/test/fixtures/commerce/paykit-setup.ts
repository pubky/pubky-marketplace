/**
 * Authorization URLs upstream paykit-server puts in its embedded setup page's QR
 * (`pubkyauth://signin_grant`, claimed by Bitkit through `x-bitkit-claim`). The
 * relay secret and client key are fixed so the rendered QR never changes.
 */
const VRT_PAYKIT_AUTHORIZATION_BASE =
  'pubkyauth://signin_grant?caps=/pub/paykit/v0/:rw&relay=https://httprelay.staging.pubky.app/link' +
  '&cid=app.paykit.server&cpk=8um71us3fyw6h8wbcxb5ar3rwusy1a6u49956ikzojg3gcwd1dty&x-bitkit-claim=paykit-access-v1';

export const VRT_PAYKIT_SETUP_AUTHORIZATION_URL = `${VRT_PAYKIT_AUTHORIZATION_BASE}&secret=vrt-paykit-setup-0000000000000000000000000`;

export const VRT_PAYKIT_RECONNECT_AUTHORIZATION_URL = `${VRT_PAYKIT_AUTHORIZATION_BASE}&secret=vrt-paykit-reconnect-000000000000000000000`;
