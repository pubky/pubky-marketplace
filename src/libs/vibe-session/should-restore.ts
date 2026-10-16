/** Only persisted metadata starts legacy migration; the retired cookie bridge never does. */
export function shouldAttemptSessionRestore(sessionExport: string | null | undefined): boolean {
  return Boolean(sessionExport);
}
