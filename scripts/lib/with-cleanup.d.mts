export function withCleanup<T>(operation: () => T | Promise<T>, cleanup: () => unknown | Promise<unknown>): Promise<T>;
