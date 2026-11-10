# Pubky Market

Peer-to-peer marketplace client built on Pubky App, with standalone and embedded Shop modes. Tech stack and versions
live in `package.json`: Next.js App Router, React with the React Compiler, TypeScript, Tailwind + Shadcn UI, Zustand,
Dexie and TanStack Query. This file is the entry point for Claude Code, Codex and Cursor; `docs/` is the canonical
source for project conventions and takes precedence over summaries here. Start with `docs/development-workflow.md`.

## Commands

Use Node 24 (`.nvmrc`) and `npm ci`. Read `docs/ecommerce/onboarding.md` for setup and
`docs/ecommerce/RUNNING.md` for backend modes and suite prerequisites.

| Task                          | Command                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Dev server                    | `npm run dev`                                                                 |
| Format, lint, types           | `npm run format:check`, `npm run lint`, `npm run typecheck`                   |
| Unit tests                    | `npm test`; one file: `npm test -- <path>`                                    |
| Sandbox service tests         | `npm run test:marketplace`                                                    |
| Pre-push gate                 | `bash scripts/prepush.sh` (fast by default)                                   |
| Full/release gate             | `PREPUSH_FULL=1 bash scripts/prepush.sh`                                      |
| Linux VRT                     | `npm run test:vrt` or `bash scripts/vrt-linux.sh <spec>` (Docker)             |
| Production build              | `npm run build`                                                               |
| Synthetic launch-critical E2E | `LAUNCH_E2E_MODE=synthetic bash scripts/ci-launch-e2e.sh` (see prerequisites) |

The pre-commit hook runs `lint-staged` and typecheck. Keep the active Market pre-push gate, Linux VRT and browser CI
checks; App's disabled pre-push hook and different VRT workflow are not replacements. Live signer/backend/payment
verification has separate prerequisites and authorization; a synthetic pass is not a live payment result.

## Architecture

```
UI (user actions) → Controllers → Application → Services → Models
Coordinators (system) ↗            ↓              ↓
                       Stores     Pipes         Database
```

Hard constraints (`docs/architecture.md`):

- Controllers never call Services directly; go through Application.
- Coordinators never call Application; go through Controllers.
- Application never accesses Stores; controllers own UI state orchestration.
- Pipes are pure: no IO or side effects. Services never call up into Application or Controllers.
- Only PostApplication, NotificationApplication, BootstrapApplication, MigrationApplication, HotApplication,
  PostStreamApplication and TtlApplication may call other Applications. Maximum depth is 1, except
  PostApplication/NotificationApplication/TtlApplication → PostStreamApplication → FileApplication may reach depth 2;
  no cycles.
- HomeserverService may read the current auth store for session, capability/ownership and logout checks. This narrow
  read-only exception does not permit service writes to stores or general access to business/UI state.

Use concrete `tsconfig.json` aliases: `@/atoms/Button/Button`, `@/hooks/*`, `@/controllers/*`, `@/application/*`,
`@/services/*`, `@/models/*`, `@/pipes/*`, `@/stores/*`, `@/config/<module>`, `@/app/routes`, `@/icons`, `@/libs/*`.
No aggregate re-export `index.ts` files under components; no `src/config/index.ts`.

Controller names describe IO: `fetch*` network only, `get*` local only, `getMany*` bulk local returning `Map<Pubky, T>`,
`getOrFetch*` local then network, `getMany*OrFetch` bulk local then fetch missing, `subscribe*` long-lived streams,
`commitCreate* | commitUpdate* | commitDelete*` optimistic writes and sync.

## Non-negotiables

- Errors: use `Err.*` factories; no raw `Error` or log-then-throw. Follow documented boundary exceptions in
  `docs/error-handling.md`.
- Local-first reads in hooks: use `useLocalFirstQuery` for the standard local-read/network-fallback pattern. Keep network,
  TanStack Query and retry logic outside `useLiveQuery`. Purely local reactive reads still use `useLiveQuery`.
  `docs/local-first.md` owns the detailed contract and limitations.
- Local-first writes: Dexie first, then homeserver sync, with rollback and affected TTL updates. Preserve dependency
  persistence order and use `buildCompositeId` / `parseCompositeId` for composite post IDs. Commerce transaction authority
  belongs to its configured backend; do not substitute a local optimistic record for an authoritative receipt or order.
- Shadcn first, atomic tiers atoms → molecules → organisms → templates, existing design tokens and the fixed z-index
  scale `-z-10, z-10, z-30, z-40, z-50, z-60`. See `docs/components.md` and `docs/z-index.md`.
- When matching Figma navigation/icons, confirm active versus inactive states from the Shadcn button variants
  (Selected/Default background, border and shadow), not just another surface or the parent frame.
- Stock Lucide icons come from `lucide-react`; custom/brand SVGs from `@/icons`; URL-to-icon helpers from
  `@/libs/utils/urlToIcon`. Do not copy SVGs into individual features.
- No `useCallback` / `useMemo` without profiler evidence; the React Compiler handles memoization.
- **Toasts**: use `toast()` from `@/molecules/Toaster/toast` with `variant` (`default` | `error` | `warning` | `info`). Pass string content and structured actions (`label`, `altText`, `onClick`); use `durationMs` only when the default 3 seconds is too short. `persistent: true` cannot be combined with `durationMs`. Toast state and renderer atoms are private. No `showErrorToast` wrappers or `className` destructive hacks. See `docs/components.md` — _Toasts_.
- Forms use react-hook-form + zod in a form hook; schema/types/defaults go in a sibling `*.types.ts`. Components call the
  hook, not mutation controllers directly. Preserve the existing submit result contract (`boolean` or a created id).
  Use Zod v4 `z.url()`, not deprecated `z.string().url()`.
- Copy is inline US English. Do not restore removed i18n infrastructure or introduce a replacement message registry.
- Bug fixes must preserve existing visible behavior. `src/config/*` limits are product-wide policy; do not tune one for
  a local fix. Preserve broader active prefixes when navigation links to a default child route.
- Database schema, indexes, versions and persisted keys need explicit review. Follow the actual migration/reset paths in
  `docs/data-patterns.md`; do not import App's different database-version assumptions. Register persisted store keys in
  `src/core/stores/persistedKeys.ts` and preserve the Shop storage namespace.
- Generated assets and lockfiles are produced by their tools, not edited by hand. Keep unrelated CI, dependency and
  deployment changes out of feature work.
- Build-time `Env` and runtime `PUBKY_RUNTIME_*` configuration have different lifetimes. Use the documented getters,
  base-path/public-path helpers and storage namespace; never put secrets in public runtime config. `docs/environment.md`.
- Observability uses the `Err.*` capture funnel and documented Sentry boundaries; never attach raw user data.
  `docs/sentry.md` owns filtering and privacy rules.
- Unit tests cover behavior and prop contracts; VRT covers appearance. No classic snapshot tests; no test escape casts
  `as any` or `as unknown as T` outside the designated typed helpers. See `docs/component-testing.md`.

## Before you edit, read

- Any change → `docs/development-workflow.md` and `docs/commit-message.md`.
- `src/core/**` → `docs/architecture.md`, `docs/local-first.md`, `docs/data-patterns.md`, `docs/error-handling.md`.
- `src/hooks/**` → `docs/local-first.md`, `docs/data-patterns.md`, `docs/components.md` (Forms).
- `src/components/**`, `src/app/**` → `docs/components.md`, `docs/z-index.md`, `docs/skeleton-architecture.md`,
  `docs/component-testing.md`.
- VRT changes → `docs/visual-regression-testing.md`; onboarding/release gates → `docs/ecommerce/onboarding.md`,
  `docs/ecommerce/release.md`.
- Env/runtime config, base paths or persistence namespaces → `docs/environment.md`, `docs/launch/shop-embedding.md`.
- Authentication, session lifecycle, approvals or embedded handoff → `docs/launch/grant-auth-session.md`,
  `docs/launch/shop-embedding.md` and the current implementation. Historical cookie/vibe docs are not current recipes.
- Commerce/backend integration → `docs/ecommerce/RUNNING.md`, `docs/ecommerce/status.md`, relevant domain docs and ADRs.
- Chat → `docs/chat/README.md`; observability → `docs/sentry.md`.
- Service worker/PWA → existing `src/sw.ts`, `next.config.ts`, `docs/environment.md` and `docs/launch/shop-embedding.md`;
  preserve Market standalone/embedded differences. The implementation uses Serwist.

## How to work here

1. Restate the requested behavior, find the nearest existing feature, trace the path and identify the affected layers.
2. Reuse before creating: search components, hooks, libs, core utilities and config for an existing equivalent.
3. Make the smallest coherent change. No unrelated cleanup, renames, reformatting, dependency swaps or pattern migrations.
4. Run the checks appropriate to the change (`docs/development-workflow.md`), including the existing pre-push gate.
5. Read your own diff for regressions, boundary violations, unexplained exceptions and stale documentation.
6. Call out schema/migration, product-limit, architecture and VRT-baseline decisions. Do not silently expand the scope.

Definition of done: the correct layers and existing primitives are used; naming/imports follow conventions; errors do not
log twice; visible behavior is preserved; relevant tests, lint and typecheck pass; pre-push evidence and any skipped
checks are reported honestly; VRT/ADR/schema/config impacts are explicit; docs describe the resulting implementation.

Commits, branches and PRs follow `docs/commit-message.md`. Use the actual intended base (`master` or an explicitly selected
train); never assume `dev`. Keep PRs draft unless requested otherwise. Release/train rules remain in
`docs/ecommerce/release.md`; changing agent instructions does not authorize deployment or a merge.

## People and names

Use GitHub handles for real people and clearly fictional names in test fixtures. Do not attribute opinions, decisions or
personal matters to people. See `docs/development-workflow.md` for the full policy.

## Tooling map

- `CLAUDE.md` imports this file. Detailed conventions live in `docs/`, not in tool-specific copies.
- `.cursor/rules/*.mdc` and `.claude/rules/*.md` point to relevant docs for matching files. Claude adapters use plain-text
  paths, not `@` imports. The existing Cursor toast rule retains its Market-specific instructions.
- Shared skills live in `.agents/skills/`, with Claude symlinks in `.claude/skills/`: `pubky-code-review` and
  `sentry-nextjs-sdk`. Cursor's `/review` entry points to the shared review skill; the Market installation-verification
  procedure remains in `.cursor/skills/marketplace-install-verify/`.
- Greptile configuration lives in `.greptile/config.json` and `.greptile/files.json`; keep referenced review guidance in
  sync. Configuration is not evidence that the external review service is enabled.
- Update canonical docs first, then their summary here and the relevant Greptile instructions. Keep adapters as pointers.
