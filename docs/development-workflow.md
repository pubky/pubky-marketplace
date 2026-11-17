# Development Workflow

How to make a focused, verifiable change to Pubky Market. `AGENTS.md` is the short entry point; the pages under `docs/`
are canonical. Shared coding standards follow Pubky App, while Market's commerce, embedding, verification and release
contracts stay specific to this repository. A similar filename or ADR number in App does not make its contents applicable
here.

## How to Approach a Change

1. Restate the requested behavior and find the nearest feature already doing it. Listings, checkout, watchlists,
   collections, settings and chat are useful reference systems; check the actual implementation before copying a pattern.
2. Trace the behavior end to end and identify the files and layers you need to change.
3. Reuse first: search for an existing component, hook, controller, pipe, utility, type or config constant before creating
   another. A component gets behavior through hooks; it does not acquire direct service or network dependencies.
4. Make the smallest coherent change. Keep unrelated refactoring, renaming, formatting, dependency swaps and pattern
   migrations out of the diff.
5. Verify at the right level, then inspect your diff for lost behavior, boundary violations and undocumented assumptions.
6. Call out changes to schema/migrations, shared product limits, architectural decisions and visual baselines. Record the
   effect on users and the validation performed; do not silently choose a new product policy to make a local fix pass.

## Existing Patterns to Reuse

- **Layering and naming:** `architecture.md` and `local-first.md`. User actions enter through controllers; system work
  enters through coordinators. Follow the documented cross-Application allow-list and controller method prefixes.
- **Local-first writes:** normalize inputs, write local state, sync and compensate on failure; update affected TTL rows
  and persist dependencies before dependents. Commerce order/payment authority is a separate backend contract, not a
  locally inferred success. See `data-patterns.md` and the commerce ADRs.
- **Reads:** use `useLocalFirstQuery` for the standard local-read/network-fallback pattern. Use `useLiveQuery` for purely
  local subscriptions; never start network or retry work inside its callback. Follow the null/missing/tombstone behavior
  of the Market implementation described in `local-first.md`.
- **Forms:** react-hook-form + zod, with schema/types/defaults beside the hook. Preserve `submit`'s success result and let
  the caller handle navigation or closing. `components.md` owns the detailed contract.
- **Errors:** use the existing `Err.*` factories and service HTTP helpers. Factories already log/capture, so do not
  log-then-throw. Keep documented SDK and availability-probe exceptions narrow (`error-handling.md`).
- **UI:** Shadcn and existing atoms/molecules first. Reuse existing loading, empty and error states; check both responsive
  branches when a Sheet replaces a Popover. Component, icon, form and existing toast conventions live in `components.md`.
- **Routes and embedding:** use `@/app/routes`; distinguish mount-path requests from public/share URLs using the helpers
  in `environment.md` and `launch/shop-embedding.md`. Do not hard-code root-relative requests that break `/shop-embed`.
- **State:** keep global UI state in existing Zustand domains and local state local. Register new persisted keys in
  `src/core/stores/persistedKeys.ts`; preserve Shop namespacing, migration and logout behavior.
- **Configuration:** `src/config/*` limits are product-wide policy. Use build-time `Env` or runtime `PUBKY_RUNTIME_*`
  getters according to `environment.md`; do not add direct environment reads in consumers.
- **Schema changes:** inspect the actual Dexie version declarations and upgrade/reset paths before changing tables,
  indexes or `DB_VERSION`. State whether an existing device upgrades in place or loses local data; do not import App's
  database-version assumptions. See `data-patterns.md` and applicable ADR amendments.

## Market Boundaries to Preserve

- Standalone and embedded operation, auth/session ownership and the Shop storage namespace are separate parts of the
  same integration contract. Read `launch/grant-auth-session.md` and `launch/shop-embedding.md` before changing them.
- Check commerce mode and feature status in `ecommerce/RUNNING.md` and `ecommerce/status.md`. Do not present sandbox or
  synthetic behavior as proof of a live transaction, signer, backend or deployment.
- Wire formats, SDK pins, receipts, payment approvals and encryption boundaries need the relevant domain documentation
  and regression coverage. Do not retire compatibility or migrations based only on a missing direct import.
- The repository contains the Next client and sandbox service under `services/marketplace`; the production transaction
  service and other external services have their own repositories. Starting `npm run dev` alone does not provision them.
- Preserve the existing pre-push, VRT, launch/chat browser checks and release proof. Shared standards alignment does not
  replace Market CI with App's workflows.

## Verification

Use Node 24 (`.nvmrc`) and the locked dependencies. Commands come from `package.json` and the existing scripts:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm test -- src/components/atoms/Button/Button.test.tsx
npm run test:marketplace
npm run build
bash scripts/prepush.sh
PREPUSH_FULL=1 bash scripts/prepush.sh
bash scripts/vrt-linux.sh <spec>
```

The pre-commit hook runs `lint-staged` and typecheck. The **fast pre-push gate** checks formatting/lint for changed files,
whole-project types and related unit tests. **Full mode** adds related Linux VRT. A valid verification stamp may be reused
by the script; report the gate's actual result rather than claiming every invocation reran every test. Linux VRT requires
Docker and the pinned browser environment; follow `visual-regression-testing.md` for comparisons and reviewed baseline
updates. Do not regenerate baselines to hide an unexplained failure.

Choose checks by the behavior changed:

| Change                                     | Verification                                                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documentation or agent/review instructions | Check commands, paths, links, globs and examples against current source; check formatting and JSON where applicable; run the existing pre-push gate. No new runtime tests merely to mirror prose. |
| Component or form                          | Relevant colocated tests, lint and typecheck; relevant VRT plus desktop/mobile loading, empty, error, focus and disabled states when appearance changes.                                          |
| Core/domain behavior                       | Relevant unit/service tests, lint and typecheck; inspect cross-layer and failure/rollback paths.                                                                                                  |
| Env/runtime config                         | Relevant env/runtime-config tests, lint and typecheck; build for route/config-wide effects.                                                                                                       |
| Auth, embedding, checkout or chat          | Relevant unit and browser/integration coverage with the documented prerequisites; preserve identity, cancellation and recovery behavior.                                                          |
| Cross-cutting runtime change               | Full unit suite, lint, typecheck and production build; relevant VRT/integration coverage.                                                                                                         |
| Release                                    | Full pre-push and the source/deployed-service evidence required by `ecommerce/release.md`.                                                                                                        |

Synthetic launch-critical browser checks use
`LAUNCH_E2E_MODE=synthetic bash scripts/ci-launch-e2e.sh`; chat has a separate local-stack suite. These need their documented
build/browser/service prerequisites. Cypress and live commerce suites are not bare-checkout unit tests. Read
`ecommerce/RUNNING.md` and `ecommerce/release.md` before running them. Do not use live credentials, send messages, make
payments or deploy simply to satisfy a checklist without the required task authorization.

CI runs formatting/lint/types, unit tests and a build with the workflow's path filters. Relevant PRs targeting `master`
or `release/shop-*` run Linux VRT and launch/chat browser checks; merge-group events also run those checks. Some docs-only
PR jobs intentionally skip. A passing or skipped status is not proof that the test body executed. GitHub branch rules
are configured separately: inspect the actual target's requirements when preparing a merge instead of inferring them
from workflow presence.

Never report a command, browser flow or deployment proof as passed unless it ran successfully against the reviewed
revision. Name skipped checks and their prerequisites. Local hooks do not replace server-side CI or review.

## Code Quality

- **Explain suppressions.** Every `eslint-disable`, `@ts-ignore` and `@ts-expect-error` needs an adjacent reason. Use the
  designated typed test helpers instead of `as any` or `as unknown as T`.
- **No dead code or unused exports in the change.** Remove proven unreachable branches, unused variables and commented-out
  code; check external consumers, configuration, dynamic loading and integration harnesses before declaring code unused.
- **No manual memoization without evidence.** React Compiler is enabled. Do not add `useMemo` or `useCallback` to paper
  over a state/data-flow problem; explain a proven need.
- **Keep interfaces focused.** Several optional flags that change a function's behavior are a reason to review its
  responsibilities; prefer a clear options contract or separate operations when appropriate.
- **Concrete imports.** No aggregate component barrels or `src/config/index.ts`; use the defining file's alias path.
- **Preserve visible behavior.** Counts, actions, routes, responsive paths and states are part of the product. Never reduce
  them or alter a global config limit merely to fix one component or make its test pass.
- **Respect generated files.** Generate service-worker output and lockfile changes with their
  owning tools. Keep dependency and CI edits tied to the requested task; do not hand-edit a lockfile or reformat unrelated
  files.
- **Keep source and instructions together.** Update affected canonical docs and their agent/review summaries when a
  convention changes. Do not teach an API that exists only in App.

## Legacy and Removed Patterns

- i18n infrastructure was removed. New copy is inline US English; do not restore `next-intl`, message catalogs,
  `useTranslations` or a replacement message registry. Older branches follow `migrations/2305-i18n-conflict-guide.md`.
- Some hooks still hand-roll local-read/fetch coordination. For new standard local-first reads, use the documented
  `useLocalFirstQuery` pattern; assess behavior before migrating an existing hook and keep unrelated migrations separate.
- Historical cookie/vibe session documents describe old protocols. Current UI sign-in and App/Shop lifecycle rules live
  in `launch/grant-auth-session.md` and `launch/shop-embedding.md`.
- ADRs preserve decision history. Check current amendments and implementation before treating an old schema version,
  branch name, deployment host or feature status as a current instruction.

## People and names

- In code, comments, docs, fixtures, commit messages and PR text, refer to real people only by GitHub handle.
- Do not attribute opinions, decisions or personal matters to people.
- Test fixtures use clearly fictional names (`Alice Example`, `Bob Example`).
- Public history retains earlier versions, so use the right names before committing.

## Definition of Done

- [ ] The change has a clear behavior, scope and correct layers; existing primitives are reused.
- [ ] Names and concrete imports follow project conventions; no unrelated refactor or dependency change.
- [ ] Error handling, local-first read/write behavior, TTL and failure/rollback paths were considered where applicable.
- [ ] Existing visible functionality and Market integration contracts remain intact.
- [ ] Relevant tests, lint, typecheck and the pre-push gate pass; additional checks follow the verification table.
- [ ] VRT baseline, ADR, schema/migration and product-limit impacts are explicit, with evidence and any limitations.
- [ ] Docs, agent summaries and review rules agree with the resulting implementation.
- [ ] The PR follows `commit-message.md`, uses its actual intended base and remains draft unless requested otherwise.
- [ ] The handoff distinguishes checks actually run from skipped, synthetic and live verification.
