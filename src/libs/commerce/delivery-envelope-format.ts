/**
 * The wire sizes of a sealed delivery address, apart from the HPKE
 * implementation so command schemas can validate shape without loading it.
 */
export const DELIVERY_PLAINTEXT_BUCKET_BYTES = 2048;
export const HPKE_ENC_BYTES = 32;
export const AEAD_TAG_BYTES = 16;
export const DELIVERY_ENVELOPE_BYTES = HPKE_ENC_BYTES + DELIVERY_PLAINTEXT_BUCKET_BYTES + AEAD_TAG_BYTES;
export const DELIVERY_KEY_ID_PATTERN = /^[0-9a-f]{32}$/;
