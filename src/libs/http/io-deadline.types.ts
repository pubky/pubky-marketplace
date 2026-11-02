/** Static route templates only: never derive these labels from a request URL. */
const IO_DEADLINE_ENDPOINTS = [
  'v0/bootstrap/:pubky',
  'v0/marketplace/attestor/:attestor_id/profile',
  'v0/marketplace/attestor/:attestor_id/annotations',
] as const;

export type IoDeadlineEndpoint = (typeof IO_DEADLINE_ENDPOINTS)[number];

export function isIoDeadlineEndpoint(value: unknown): value is IoDeadlineEndpoint {
  return IO_DEADLINE_ENDPOINTS.some((endpoint) => endpoint === value);
}
