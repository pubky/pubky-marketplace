// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../../..');
const SRC = join(ROOT, 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(entry) || /\.(test|vrt\.test)\.(ts|tsx)$/.test(entry)) return [];
    return [path];
  });
}

describe('@synonymdev/pubky 0.16 call sites', () => {
  const files = sourceFiles(SRC).map((path) => ({
    path: relative(ROOT, path),
    text: readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
  }));

  it('no Pubky.restoreSession call site in src', () => {
    const offenders = files
      .filter(({ text }) => /\b(pubkySdk|getPubkySdk\(\))\.restoreSession\(/.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('no cookie sign-in or signup calls on the pubky SDK', () => {
    const offenders = files
      .filter(({ text }) =>
        /\b(pubkySdk|getPubkySdk\(\))\.startAuthFlow\(|\bsigner\.(signinCookie|signupCookie)\(/.test(text),
      )
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('one @synonymdev/pubky 0.16.2 in lockfile', () => {
    const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { version?: string }>;
    };
    const copies = Object.entries(lock.packages).filter(([path]) => path.endsWith('node_modules/@synonymdev/pubky'));
    expect(copies.map(([path, entry]) => [path, entry.version])).toEqual([
      ['node_modules/@synonymdev/pubky', '0.16.2'],
    ]);
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      overrides: Record<string, Record<string, string>>;
    };
    // The SDK is pinned in exactly one place: the root dependency. The override
    // makes @bitcoinerrorlog/pubky-shop resolve the same copy, so moving the
    // pin is one edit.
    expect(pkg.dependencies['@synonymdev/pubky']).toBe('0.16.2');
    expect(pkg.overrides['@bitcoinerrorlog/pubky-shop']['@synonymdev/pubky']).toBe('$@synonymdev/pubky');
  });

  it('the pinned SDK carries scoped encryption keys (the e action and EncryptionKeys)', () => {
    const declarations = readFileSync(join(ROOT, 'node_modules/@synonymdev/pubky/pubky.d.ts'), 'utf8');
    expect(declarations).toContain('export class EncryptionKeys');
    expect(declarations).toContain('approvalFormat?: GrantApprovalFormat');
    expect(declarations).toMatch(/export type CapabilityAction = [^;]*"rwe"/);
  });

  it('routes every direct session-storage write through HomeserverService retry policy', () => {
    const offenders = files
      .filter(({ path, text }) => {
        if (path === 'src/core/services/homeserver/homeserver.ts') return false;
        return /\.storage\.(?:putJson|putBytes|putText|delete)(?:Locked)?\(/.test(text);
      })
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });
});
