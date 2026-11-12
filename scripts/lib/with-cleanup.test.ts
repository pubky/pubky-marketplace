// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { withCleanup } from './with-cleanup.mjs';

describe('script cleanup failure precedence', () => {
  it('returns the result only after cleanup completes', async () => {
    const order: string[] = [];
    await expect(
      withCleanup(
        () => {
          order.push('operation');
          return 42;
        },
        () => {
          order.push('cleanup');
        },
      ),
    ).resolves.toBe(42);
    expect(order).toEqual(['operation', 'cleanup']);
  });

  it('fails when only cleanup fails', async () => {
    const cleanup = new Error('cleanup failed');
    await expect(
      withCleanup(
        () => 42,
        () => {
          throw cleanup;
        },
      ),
    ).rejects.toBe(cleanup);
  });

  it.each([undefined, null, false, 0, 'operation failed', new Error('operation failed')])(
    'preserves any operation rejection after successful cleanup: %s',
    async (primary) => {
      const cleanup = vi.fn();
      await expect(
        withCleanup(() => {
          throw primary;
        }, cleanup),
      ).rejects.toBe(primary);
      expect(cleanup).toHaveBeenCalledOnce();
    },
  );

  it('keeps both failures with the primary cause and diagnostic first', async () => {
    const primary = new Error('operation failed');
    const cleanup = new Error('cleanup failed');
    const error = await withCleanup(
      () => {
        throw primary;
      },
      () => {
        throw cleanup;
      },
    ).catch((error: unknown) => error);
    expect(error).toMatchObject({ message: primary.message, cause: primary, errors: [primary, cleanup] });
  });
});
