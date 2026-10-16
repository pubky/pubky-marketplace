import { describe, expect, it } from 'vitest';
import { readBuildCommit } from './build-info';

const FULL_SHA = '2F844C1084C432D8DD6D7E66C320DCAEEB9EB02E';

describe('readBuildCommit', () => {
  it('shortens a full SHA to 12 lowercase characters', () => {
    expect(readBuildCommit({ GIT_COMMIT: FULL_SHA })).toBe('2f844c1084c4');
  });

  it('falls back to the Vercel git SHA', () => {
    expect(readBuildCommit({ VERCEL_GIT_COMMIT_SHA: FULL_SHA })).toBe('2f844c1084c4');
  });

  it('prefers GIT_COMMIT over the Vercel value', () => {
    expect(readBuildCommit({ GIT_COMMIT: 'abcdef1234567890', VERCEL_GIT_COMMIT_SHA: FULL_SHA })).toBe('abcdef123456');
  });

  it('keeps a short SHA and trims whitespace', () => {
    expect(readBuildCommit({ GIT_COMMIT: ' 2f844c1\n' })).toBe('2f844c1');
  });

  it('skips an invalid GIT_COMMIT and uses the next source', () => {
    expect(readBuildCommit({ GIT_COMMIT: 'unknown', VERCEL_GIT_COMMIT_SHA: FULL_SHA })).toBe('2f844c1084c4');
  });

  it.each([undefined, '', 'abc12', 'not-a-sha-at-all', '2f844c1 internal-host.example'])(
    'reports unknown for %j',
    (value) => {
      expect(readBuildCommit({ GIT_COMMIT: value, VERCEL_GIT_COMMIT_SHA: value })).toBe('unknown');
    },
  );

  it('reports unknown when nothing is set', () => {
    expect(readBuildCommit({})).toBe('unknown');
  });
});
