# Documentation

Canonical documentation for Pubky Market. `../AGENTS.md` is the shared entry point for coding agents; these pages own
the detailed conventions. Start with [Development workflow](development-workflow.md), then the domain guide for the
change. Current runbooks and implementation take precedence over explicitly historical proposals and ADR versions.
Project documents come first below; shared coding standards follow under [Client standards and architecture](#client-standards-and-architecture).

## Shop launch

Handoff readiness lives in these docs; start with the team brief.

- [Team brief](launch/shop-team-brief.md): repos, local setup, test and release rules, the current status, first tasks for each team, per-service release, deploy and rollback with known documentation gaps, and who to ask, for developers taking over the Shop.
- [Beta launch and handoff plan](launch/shop-launch-plan.md): this week's deadlines and what's frozen, launch blockers, the two-week timeline, infrastructure options, risks and the open decisions with who makes each, for the [shop.pubky.app](https://shop.pubky.app) beta.
- [Verifying a marketplace installation](launch/install-verification.md): the post-deployment check of every service, its wiring, keys, origins, migrations and versions, with the fix for each failure.

## Marketplace

- [Developer onboarding](ecommerce/onboarding.md): run, test and release the Shop; the repositories behind it.
- [Running the marketplace locally](ecommerce/RUNNING.md): the four commerce modes (`unavailable`, `sandbox`, `transaction-service`, `locks-paykit`), the sandbox service and the test suites.
- [Feature inventory](ecommerce/FEATURES.md): every marketplace feature with its honesty label, including digital delivery.
- [Status](ecommerce/status.md): what is real, simulated or deferred, with the proof ledger. The authority on honesty about the feature.
- [Release](ecommerce/release.md) and [release notes](ecommerce/release-notes/): the release lane, the pre-push and release gates, and the notes for each `shop-v*` tag.
- [Environment variables](environment.md): build-time and `PUBKY_RUNTIME_*` configuration, including the marketplace, Paykit, USDT and framing keys.
- [USDT payments](ecommerce/usdt-payments.md): the dark flag, the payment option model and the service gate.
- [Serving the Shop inside pubky.app](launch/shop-embedding.md): base path, framing, embedded mode and the `shop-` storage namespace.
- [Chat](chat/README.md): buyer↔seller messages as end-to-end encrypted files on the sender's homeserver, delivered through homeserver event streams, `pubky/inbox` pings and reconciliation; the design decision is [ADR 0030](adr/0030-chat-transport.md).
- [Upstream integration](ecommerce/upstream-integration.md): pinned Locks, Paykit and Paykit server contracts.
- Architectural decisions: [`adr/`](adr/), indexed in [`architecture.md`](architecture.md). ADRs 0019 to 0030 cover the marketplace (transaction authority, public records, namespaces, the Rust service, portable reputation, drops, the indexer contract, the vibe session consumer and the chat transport).

## Single sign-on

- [SSO proposal](sso/sso-proposal-for-team.md): the problem, the proposed delegated-grant model, phases, per-repo changes and asks for each Pubky team.
- [SSO design](sso/pubky-sso-design.md): the design detail behind the proposal, with the code facts it rests on and the open questions for the Pubky core team.

## Other folders

- [marketplace-overview.md](marketplace-overview.md): every repository, branch and document behind the marketplace feature.
- [spec-feedback/](spec-feedback/): technical briefs for upstream maintainers.
- [contributions/](contributions/): PR triage.
- [vibes/](vibes/) and [vrt/](vrt/): agent operations notes and visual-regression screenshots.

## How to comment

- **Questions, objections or answers to an open question:** [open an issue](https://github.com/pubky/pubky-marketplace/issues/new). Name the doc and section in the title, for example "SSO proposal §4 Q3: one bearer per grant".
- **Line-level comments:** open a pull request against `master` that edits the doc, or comment on lines in any open PR touching it.
- **Corrections and edits:** send a pull request with the change. Keep links between these docs relative so they work on GitHub and in clones.

## Client standards and architecture

Single source of truth for all project standards, conventions, and architectural decisions.

### Quick Reference

| Working on...                                         | Read these docs                                                                   |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| Any change                                            | `../AGENTS.md`, `development-workflow.md`                                         |
| `src/core/`                                           | `architecture.md`, `local-first.md`, `error-handling.md`, `data-patterns.md`      |
| `src/hooks/`                                          | `local-first.md`, `data-patterns.md`, `components.md`                             |
| Components or routes                                  | `components.md`, `skeleton-architecture.md`, `z-index.md`, `component-testing.md` |
| Env, runtime config, base paths or storage namespaces | `environment.md`, `launch/shop-embedding.md`                                      |
| Auth or embedded sessions                             | `launch/grant-auth-session.md`, `launch/shop-embedding.md`                        |
| Commerce/backend integration                          | `ecommerce/RUNNING.md`, `ecommerce/status.md`, relevant domain guide and ADRs     |
| Chat                                                  | `chat/README.md`                                                                  |
| Observability                                         | `sentry.md`                                                                       |
| Writing tests or changing visual baselines            | `component-testing.md`, `visual-regression-testing.md`                            |
| Commits, branches, PRs                                | `commit-message.md`                                                               |
| Release                                               | `ecommerce/onboarding.md`, `ecommerce/release.md`                                 |
| Architectural decisions                               | `adr-guidelines.md`, `adr/`                                                       |

### Documentation Files

| File                           | Description                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `development-workflow.md`      | Scope, reuse, verification, code quality, definition of done                      |
| `architecture.md`              | Layering, dependency boundaries, anti-patterns and ADR index                      |
| `local-first.md`               | Local-first writes, controller naming, `useLocalFirstQuery` reads and limitations |
| `data-patterns.md`             | Composite IDs, streams, TTL, normalization and schema changes                     |
| `error-handling.md`            | AppError, Err factories and boundary exceptions                                   |
| `components.md`                | Shadcn, atomic design, Figma, icons, forms and current Market toast conventions   |
| `component-testing.md`         | Behavior and prop-contract unit tests                                             |
| `visual-regression-testing.md` | Linux VRT, fixtures, CI and reviewed baseline updates                             |
| `skeleton-architecture.md`     | Loader placement, naming and testing                                              |
| `z-index.md`                   | Layering conventions                                                              |
| `commit-message.md`            | Commit, branch and PR conventions                                                 |
| `environment.md`               | Build-time and runtime configuration, paths, embedding and storage                |
| `sentry.md`                    | Capture boundaries, privacy, filtering and source maps                            |
| `adr-guidelines.md`            | When and how to record architectural decisions                                    |

#### Shop (marketplace)

| File                      | Description                                                             |
| ------------------------- | ----------------------------------------------------------------------- |
| `ecommerce/onboarding.md` | Start here: repositories, access, run, test, merge, who to ask          |
| `ecommerce/RUNNING.md`    | Running the marketplace locally in every mode, and the live test suites |
| `ecommerce/release.md`    | Release train, VRT baselines, signed-in production proof, tags          |
| `ecommerce/status.md`     | What is real and what is simulated                                      |

#### Migrations

| File                                     | Description                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| `migrations/2305-i18n-conflict-guide.md` | Resolving branch conflicts against the i18n removal (delete after the open-PR wave clears) |

### Architecture Decision Records

Stored in `adr/`. See `architecture.md` for the full index.

### AI and Editor Workflows

Claude Code, Codex and Cursor share the same canonical instructions:

| Layer                      | Files                                                                          | Purpose                                                   |
| -------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Entry point                | `../AGENTS.md`, imported by `../CLAUDE.md`                                     | Commands, hard rules, doc routing and completion criteria |
| Conventions                | This `docs/` folder                                                            | Canonical detailed rules                                  |
| Path adapters              | `../.cursor/rules/*.mdc`, `../.claude/rules/*.md`                              | Select the relevant documentation for matching files      |
| Shared skills              | `../.agents/skills/`, linked from `../.claude/skills/`                         | `pubky-code-review` and `sentry-nextjs-sdk`               |
| Cursor review entry        | `../.cursor/skills/code-review/SKILL.md`                                       | Compatibility entry to the shared review procedure        |
| Market installation checks | `../.cursor/skills/marketplace-install-verify/`                                | Existing deployment verification procedure                |
| Greptile                   | `../.greptile/config.json`, `../.greptile/files.json`, `../.greptile/rules.md` | Repository review rules and path-specific context         |

Claude adapters name documents in plain text rather than `@`-importing them, preserving path-scoped loading. Cursor
adapters keep `@docs/…` pointers. The commit-message Cursor rule is agent-requested and has no Claude twin; `AGENTS.md`
already directs every tool to commit/PR conventions. The existing Cursor toast rule retains its Market-specific policy.

Keep tool adapters small. When a convention changes, update its canonical doc first (plus an ADR for architectural
changes), then the short summary in `AGENTS.md`, then applicable Greptile rules and context mappings. Adding a new doc
may also need matching globs. Repository configuration describes desired reviews; it does not prove that the external
Greptile service is activated or that a review ran.

### Keeping Documentation Updated

- **Agent workflow and completion:** `development-workflow.md`, with the short summary in `../AGENTS.md`.
- **Core architecture:** `architecture.md` and an ADR when the decision changes.
- **Local-first, TTL and schema:** `local-first.md`, `data-patterns.md` and relevant ADR amendments.
- **Components, forms, icons and existing toast contracts:** `components.md`; do not substitute another repo's API.
- **Skeleton loaders:** `skeleton-architecture.md`.
- **Errors and observability:** `error-handling.md`, `sentry.md`.
- **Testing and VRT:** `component-testing.md`, `visual-regression-testing.md`; preserve Market's checks and baseline workflow.
- **Env, runtime and embedding:** `environment.md`, `launch/shop-embedding.md`.
- **Auth/session lifecycle:** `launch/grant-auth-session.md`; mark historical protocols as historical.
- **Commerce/chat behavior:** the relevant domain guide, `ecommerce/status.md` and `chat/README.md` as appropriate.
- **Commits, branches and PRs:** `commit-message.md`.
- **Release and deployed proof:** `ecommerce/onboarding.md`, `ecommerce/release.md`.
