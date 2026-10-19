// Pure helpers for verify.mjs. No network, no process state: unit-tested by lib.test.mjs.
import { createHash } from 'node:crypto';

/** Parses a dotenv-style file: KEY=VALUE, `#` comments, optional single or double quotes. */
export function parseEnvFile(text) {
  const out = {};
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    // The line itself is never echoed: it may hold a secret.
    if (!match) throw new Error(`line ${index + 1} is not KEY=VALUE`);
    let value = match[2];
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    out[match[1]] = value;
  }
  return out;
}

function stripTomlComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === '\\' && quote === '"') i += 1;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '#') return line.slice(0, i);
  }
  return line;
}

function parseTomlScalar(text) {
  const value = text.trim();
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^[+-]?\d[\d_]*(\.\d+)?$/.test(value)) return Number(value.replace(/_/g, ''));
  return value;
}

function splitTomlArray(body) {
  const items = [];
  let quote = null;
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quote) {
      current += c;
      if (c === '\\' && quote === '"') {
        current += body[i + 1] ?? '';
        i += 1;
      } else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      current += c;
    } else if (c === ',') {
      if (current.trim()) items.push(current);
      current = '';
    } else current += c;
  }
  if (current.trim()) items.push(current);
  return items.map(parseTomlScalar);
}

/**
 * Reads the subset of TOML the Paykit and Locks configs use (tables, dotted tables, strings,
 * booleans, numbers, string arrays) into a flat `table.key -> value` map. Inline tables are kept
 * as raw text. Callers read only named non-secret keys from the result.
 */
export function parseTomlFlat(text) {
  const out = {};
  let table = '';
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = stripTomlComment(lines[i]).trim();
    if (!line) continue;
    const header = line.match(/^\[\s*([A-Za-z0-9_.-]+)\s*\]$/);
    if (header) {
      table = header[1];
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value.startsWith('[')) {
      while (!/\]\s*$/.test(value) && i + 1 < lines.length) {
        i += 1;
        value += ' ' + stripTomlComment(lines[i]).trim();
      }
      out[table ? `${table}.${kv[1]}` : kv[1]] = splitTomlArray(value.trim().slice(1, -1));
    } else {
      out[table ? `${table}.${kv[1]}` : kv[1]] = parseTomlScalar(value);
    }
  }
  return out;
}

/**
 * The Lock Server's return origins for the acquisition method it runs. `grant-connect` (the
 * production mode) reads its own list and never falls back to the legacy one, so checking the
 * legacy table on a grant-connect server would verify an allow-list the server does not use.
 */
export function locksReturnOriginsFromToml(toml) {
  const prefix = 'creator_authority_acquisition';
  const table = toml[`${prefix}.method`] === 'grant-connect' ? 'grant_connect' : 'legacy_connect';
  return toml[`${prefix}.${table}.allowed_return_origins`];
}

/** Splits a list given as a JSON array, a TOML array, or comma/space separated text. */
export function parseList(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value === undefined || value === null) return [];
  const text = String(value).trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return splitTomlArray(text.slice(1, -1)).map(String);
    }
  }
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Lower-cased scheme://host[:port] with default ports removed, or null for a non-URL. */
export function normalizeOrigin(value) {
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/** Whether a Content-Security-Policy's frame-ancestors directive names exactly this origin. */
export function frameAncestorsAllow(csp, origin) {
  const directive = String(csp ?? '')
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .find((tokens) => tokens[0]?.toLowerCase() === 'frame-ancestors');
  const wanted = normalizeOrigin(origin);
  return Boolean(wanted && directive?.slice(1).some((token) => normalizeOrigin(token) === wanted));
}

/** Environment-style booleans: 1, true, yes, on. */
export function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? '').trim());
}

/** A base URL without trailing slashes, for equality between configured and published URLs. */
export function normalizeBase(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value).trim());
    return `${url.origin.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return String(value).trim().replace(/\/+$/, '');
  }
}

/**
 * The Shop's landing path (`SHOP_PATH`). Unset means `/marketplace`. A value is joined straight onto each
 * origin, so one without a leading slash would build a different host (`https://staging.pubky.appshop`).
 */
export function parseShopPath(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '/marketplace';
  if (!/^\/(?!\/)[^\s?#]*$/.test(raw)) {
    throw new Error('SHOP_PATH must start with one "/" and carry no query, fragment or spaces (for example /shop/marketplace)');
  }
  return raw.length > 1 ? raw.replace(/\/+$/, '') : raw;
}

/**
 * The mount path of the Shop build the App frames (`SHOP_EMBED_PATH`, `/shop-embed` at pubky.app). Unset means the
 * Shop is not served as a separate build behind a wrapper. Same shape as the Shop's `NEXT_PUBLIC_BASE_PATH`.
 */
export function parseEmbedPath(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (!/^\/[A-Za-z0-9][A-Za-z0-9._~-]*(\/[A-Za-z0-9][A-Za-z0-9._~-]*)*$/.test(raw) || raw.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error('SHOP_EMBED_PATH must be a mount path such as /shop-embed: leading slash, no trailing slash, no query or fragment');
  }
  return raw;
}

/**
 * The path people use to reach the Shop, from its landing path: `/shop/marketplace` is served at `/shop`, the bare
 * `/marketplace` at the origin root. Undefined when the landing path does not end in `/marketplace`.
 */
export function publicBasePath(shopPath) {
  if (shopPath === '/marketplace') return '';
  return shopPath.endsWith('/marketplace') ? shopPath.slice(0, -'/marketplace'.length) : undefined;
}

/**
 * Whether nothing in the response stops a same-origin page from framing it. Browsers apply both headers, so each
 * must allow it: a CSP `frame-ancestors` directive, when present, names `'self'` (or the page's own origin), and an
 * `X-Frame-Options`, when present, is SAMEORIGIN. The Shop answers `frame-ancestors 'self'` plus
 * `X-Frame-Options: SAMEORIGIN` for the App's iframe; a proxy that adds DENY in front of it breaks the wrapper.
 */
export function framableBySameOrigin(csp, xFrameOptions, origin) {
  const directive = String(csp ?? '')
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .find((tokens) => tokens[0]?.toLowerCase() === 'frame-ancestors');
  const wanted = normalizeOrigin(origin);
  const cspAllows =
    !directive || directive.slice(1).some((token) => token === "'self'" || (wanted && normalizeOrigin(token) === wanted));
  const option = String(xFrameOptions ?? '').trim().toLowerCase();
  return Boolean(cspAllows && (option === '' || option === 'sameorigin'));
}

/**
 * PayPal sends the buyer back to `{PUBLIC_APP_ORIGIN}/marketplace/orders` for both `return` and `cancel_return`,
 * as a top-level page load. The value must therefore be a Shop origin plus the public path (`https://pubky.app/shop`,
 * the App's wrapper), not the mount path of the framed build, which would land the buyer on the Shop outside the App.
 * Returns `{ ok, detail, hint }`.
 */
export function checkPaypalReturnBase(value, { origins, publicBase, embedPath }) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    return { ok: false, detail: 'not a URL', hint: 'set PUBLIC_APP_ORIGIN on the marketplace service to the Shop origin plus its public path, for example https://pubky.app/shop' };
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.search || url.hash) {
    return { ok: false, detail: String(value), hint: 'PUBLIC_APP_ORIGIN is an http(s) origin plus a path, with no query or fragment' };
  }
  const actual = normalizeBase(url.href);
  const expected = origins.map((origin) => `${normalizeOrigin(origin)}${publicBase}`);
  if (embedPath && url.pathname.replace(/\/+$/, '') === embedPath) {
    return { ok: false, detail: `${actual}/marketplace/orders`, hint: `PayPal would return the buyer to ${embedPath}, the build the App frames, outside the App. Set PUBLIC_APP_ORIGIN to ${expected[0] ?? `<origin>${publicBase}`}` };
  }
  if (expected.includes(actual)) return { ok: true, detail: `${actual}/marketplace/orders` };
  return { ok: false, detail: `${actual}/marketplace/orders`, hint: `set PUBLIC_APP_ORIGIN to ${expected.join(' or ') || `<origin>${publicBase}`}: the buyer lands on {value}/marketplace/orders` };
}

/**
 * The Lock Server keys Paykit trusts, from its parsed config. Paykit rc13 reads the closed
 * `[signed_services] trusted_public_keys` allowlist (Locks and marketplace service keys together) and rejects the
 * retired `[locks] trusted_public_key`, which is read only when the new table is absent so an older config still
 * verifies. Returns undefined when neither is present.
 */
export function paykitTrustedKeys(toml) {
  const list = toml['signed_services.trusted_public_keys'];
  if (list !== undefined) return parseList(list);
  const legacy = toml['locks.trusted_public_key'];
  return legacy === undefined ? undefined : [String(legacy)];
}

/**
 * Whether the Shop's runtime config wires the chat inbox (`pubky/inbox`). Without `inboxUrl` the Shop never opens an
 * inbox session, so a stranger's first message reaches the recipient only when they open that thread. Returns
 * `{ ok, detail, hint, url }` where `url` is the inbox base with no trailing slash when it is set and valid.
 */
export function checkInboxRuntime(runtime) {
  const raw = runtime?.inboxUrl;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return {
      ok: false,
      detail: 'inboxUrl unset',
      hint: 'set PUBKY_RUNTIME_INBOX_URL (and PUBKY_RUNTIME_INBOX_AUDIENCE, equal to INBOX_AUTH__AUDIENCE on the inbox service) on the Shop and restart it: without it a seller is not told about a stranger’s first message',
    };
  }
  const origin = normalizeOrigin(raw);
  if (!origin) return { ok: false, detail: `inboxUrl ${raw}`, hint: 'PUBKY_RUNTIME_INBOX_URL must be an http(s) URL' };
  return { ok: true, detail: normalizeBase(String(raw)), url: normalizeBase(String(raw)) };
}

/**
 * Whether a CORS `access-control-allow-origin` value lets `origin` call a bearer-token API. The inbox
 * authenticates with a bearer token and no cookies, so `*` is a valid answer there (unlike the marketplace service,
 * whose allow-list must name exact origins).
 */
export function corsAllowsOrigin(allowOrigin, origin) {
  if (!allowOrigin) return false;
  const value = String(allowOrigin).trim();
  return value === '*' || normalizeOrigin(value) === normalizeOrigin(origin);
}

/** Origins in `required` that `allowed` does not list. A `*` entry is reported separately by callers. */
export function missingOrigins(allowed, required) {
  const have = new Set(parseList(allowed).map(normalizeOrigin).filter(Boolean));
  return parseList(required)
    .map(normalizeOrigin)
    .filter((origin) => origin && !have.has(origin));
}

/**
 * JSON.parse that tolerates raw control characters inside strings (Nexus serves listing
 * descriptions with unescaped newlines and tabs), like Python's json.loads(strict=False).
 */
export function parseJsonLenient(text) {
  try {
    return JSON.parse(text);
  } catch {
    let out = '';
    let inString = false;
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];
      if (inString) {
        if (c === '\\') {
          out += c + (text[i + 1] ?? '');
          i += 1;
          continue;
        }
        if (c === '"') inString = false;
        const code = c.charCodeAt(0);
        out += code < 0x20 ? `\\u${code.toString(16).padStart(4, '0')}` : c;
      } else {
        if (c === '"') inString = true;
        out += c;
      }
    }
    return JSON.parse(out);
  }
}

/** Extracts the Shop's `window.__PUBKY_CONFIG__ = Object.freeze({...})` runtime config from page HTML. */
export function extractRuntimeConfig(html) {
  const start = html.indexOf('__PUBKY_CONFIG__=Object.freeze(');
  if (start < 0) return null;
  const open = html.indexOf('{', start);
  let depth = 0;
  let quote = false;
  for (let i = open; i < html.length; i += 1) {
    const c = html[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === '"') quote = false;
    } else if (c === '"') quote = true;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(html.slice(open, i + 1));
    }
  }
  return null;
}

/** sqlx records SHA-384 of the migration file bytes; `.down.sql` files are never applied. */
export function expectedMigration(fileName, bytes) {
  const match = fileName.match(/^(\d+)_.+?(\.up)?\.sql$/);
  if (!match || fileName.endsWith('.down.sql')) return null;
  return {
    version: Number(match[1]),
    file: fileName,
    checksum: createHash('sha384').update(bytes).digest('hex'),
  };
}

/** Parses `MIV|<version>|<success>|<checksum-hex>` rows printed by the migration query. */
export function parseMigrationRows(stdout) {
  const rows = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const match = line.trim().match(/^MIV\|(\d+)\|(t|f|true|false)\|([0-9a-f]*)$/);
    if (match) rows.push({ version: Number(match[1]), success: match[2].startsWith('t'), checksum: match[3] });
  }
  return rows;
}

/** Compares the applied ledger with the source's migration set. */
export function compareMigrations(expected, applied) {
  const byVersion = new Map(applied.map((row) => [row.version, row]));
  const expectedVersions = new Set(expected.map((m) => m.version));
  const missing = [];
  const mismatched = [];
  const failed = [];
  for (const migration of expected) {
    const row = byVersion.get(migration.version);
    if (!row) missing.push(migration.version);
    else if (!row.success) failed.push(migration.version);
    else if (row.checksum !== migration.checksum) mismatched.push(migration.version);
  }
  const extra = applied.filter((row) => !expectedVersions.has(row.version)).map((row) => row.version);
  return { missing, mismatched, failed, extra, ok: !missing.length && !mismatched.length && !failed.length && !extra.length };
}

/** `owner/repo@ref` (GitHub) into its parts; the ref may be a branch, tag or commit SHA. */
export function parseSourceRef(value) {
  const match = String(value ?? '').match(/^([\w.-]+)\/([\w.-]+)@([\w./-]+)$/);
  return match ? { owner: match[1], repo: match[2], ref: match[3] } : null;
}

/** Splits `registry/name[:tag][@sha256:digest]` into registry, repository and reference. */
export function parseImageRef(ref) {
  const at = ref.indexOf('@');
  let name = at >= 0 ? ref.slice(0, at) : ref;
  let reference = at >= 0 ? ref.slice(at + 1) : null;
  const slash = name.indexOf('/');
  const first = slash >= 0 ? name.slice(0, slash) : '';
  let registry = 'registry-1.docker.io';
  if (slash >= 0 && (first.includes('.') || first.includes(':') || first === 'localhost')) {
    registry = first;
    name = name.slice(slash + 1);
  } else if (slash < 0) {
    name = `library/${name}`;
  }
  const colon = name.lastIndexOf(':');
  if (colon > 0) {
    if (!reference) reference = name.slice(colon + 1);
    name = name.slice(0, colon);
  }
  return { registry, repository: name, reference: reference ?? 'latest' };
}

/** Parses a `WWW-Authenticate: Bearer realm="…",service="…",scope="…"` challenge. */
export function parseBearerChallenge(header) {
  if (!header || !/^bearer\s/i.test(header)) return null;
  const params = {};
  for (const match of header.matchAll(/(\w+)="([^"]*)"/g)) params[match[1]] = match[2];
  return params.realm ? params : null;
}

/** First 12 characters of a key or hash, for output that must not reproduce full identifiers. */
export function short(value) {
  const text = String(value ?? '');
  return text.length > 14 ? `${text.slice(0, 12)}…` : text;
}

const SECRETISH = /(postgres(ql)?|redis|mysql|amqp):\/\/[^\s"']+|bearer\s+[^\s"']+|(secret|password|token|key)=([^&\s"']+)/gi;

/** Scrubs connection strings, bearer tokens and `secret=` style parameters from text before output. */
export function redact(text) {
  return String(text ?? '').replace(SECRETISH, (match) => {
    const scheme = match.match(/^(\w+):\/\//);
    if (scheme) return `${scheme[1]}://[redacted]`;
    if (/^bearer/i.test(match)) return 'Bearer [redacted]';
    return match.replace(/=.*/, '=[redacted]');
  });
}
