import { describe, expect, it } from 'vitest';
import { isFullCommitSha, readBuildCommit, resolveSentryRelease } from './build-info';

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

describe('isFullCommitSha', () => {
  it('accepts a 40-character hex SHA in either case', () => {
    expect(isFullCommitSha(FULL_SHA)).toBe(true);
    expect(isFullCommitSha(FULL_SHA.toLowerCase())).toBe(true);
  });

  it.each(['', '1.5.0', '2f844c1084c4', `${FULL_SHA}0`, ` ${FULL_SHA}`, 'g'.repeat(40)])('rejects %j', (value) => {
    expect(isFullCommitSha(value)).toBe(false);
  });
});

describe('resolveSentryRelease', () => {
  const PACKAGE_VERSION = '1.5.0';

  it('returns an explicit NEXT_PUBLIC_APP_VERSION verbatim, ahead of any commit variable', () => {
    expect(
      resolveSentryRelease(
        { NEXT_PUBLIC_APP_VERSION: 'abc', GIT_COMMIT: FULL_SHA, VERCEL_GIT_COMMIT_SHA: FULL_SHA },
        PACKAGE_VERSION,
      ),
    ).toBe('abc');
  });

  it('uses the full lowercase GIT_COMMIT from a Vercel CLI deploy', () => {
    expect(resolveSentryRelease({ GIT_COMMIT: ` ${FULL_SHA}\n` }, PACKAGE_VERSION)).toBe(FULL_SHA.toLowerCase());
  });

  it('uses the Vercel git SHA when GIT_COMMIT is absent', () => {
    expect(resolveSentryRelease({ VERCEL_GIT_COMMIT_SHA: FULL_SHA }, PACKAGE_VERSION)).toBe(FULL_SHA.toLowerCase());
  });

  it('prefers GIT_COMMIT over the Vercel value', () => {
    const other = 'a'.repeat(40);
    expect(resolveSentryRelease({ GIT_COMMIT: other, VERCEL_GIT_COMMIT_SHA: FULL_SHA }, PACKAGE_VERSION)).toBe(other);
  });

  it('skips a short or invalid GIT_COMMIT and uses the next source', () => {
    expect(resolveSentryRelease({ GIT_COMMIT: '2f844c1', VERCEL_GIT_COMMIT_SHA: FULL_SHA }, PACKAGE_VERSION)).toBe(
      FULL_SHA.toLowerCase(),
    );
  });

  it('treats a blank NEXT_PUBLIC_APP_VERSION as unset', () => {
    expect(resolveSentryRelease({ NEXT_PUBLIC_APP_VERSION: '  ', GIT_COMMIT: FULL_SHA }, PACKAGE_VERSION)).toBe(
      FULL_SHA.toLowerCase(),
    );
  });

  it('falls back to the package version without a usable commit', () => {
    expect(resolveSentryRelease({}, PACKAGE_VERSION)).toBe(PACKAGE_VERSION);
    expect(resolveSentryRelease({ GIT_COMMIT: 'unknown', VERCEL_GIT_COMMIT_SHA: '2f844c1' }, PACKAGE_VERSION)).toBe(
      PACKAGE_VERSION,
    );
  });
});
