/**
 * Always attempt cleanup without replacing an operation's failure. Callers sanitize
 * SDK/HTTP failures at their boundary before exposing either error to diagnostics.
 */
export async function withCleanup(operation, cleanup) {
  let result;
  let failed = false;
  let primary;
  try {
    result = await operation();
  } catch (error) {
    failed = true;
    primary = error;
  }
  try {
    await cleanup();
  } catch (error) {
    if (failed) {
      throw new AggregateError(
        [primary, error],
        primary instanceof Error ? primary.message : 'Operation failed before cleanup',
        { cause: primary },
      );
    }
    throw error;
  }
  if (failed) throw primary;
  return result;
}
