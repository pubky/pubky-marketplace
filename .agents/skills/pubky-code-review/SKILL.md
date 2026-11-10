---
name: pubky-code-review
description: Review Marketplace PRs, branch changes, or local changes against canonical project rules, with verified findings, applicable callouts and recorded checks.
---

# Marketplace Code Review

Review the scope the user requested. This skill is shared by Codex, Claude and
Cursor; tool-specific entry points delegate here. Read `AGENTS.md` and
`docs/development-workflow.md` first. Canonical project policy lives in `docs/`;
`.greptile/config.json`, `.greptile/files.json` and `.greptile/rules.md` provide
review coverage and references, not a substitute for the relevant documentation.

A request to review does not authorize edits, publication, a merge, deployment,
baseline regeneration or live operations. Follow any separate explicit request
for those actions. Give concise progress updates rather than hiding the work.

## 1. Establish the exact scope

Use the PR, branch, commit or paths already named by the user. Ask only when a
missing detail changes what should be reviewed; do not repeat a scope question
that the user has answered.

- **PR:** obtain its actual `baseRefName`, head SHA and head repository using
  `gh pr view <number> --json baseRefName,headRefOid,headRepository,headRepositoryOwner`.
  Fetch that base and the PR head, and review the merge-base diff. GitHub's
  `refs/pull/<number>/head` can be fetched into a separate review ref, including
  fork PRs. Never assume `origin/dev`, `master` or a tracking upstream is the PR base.
- **Branch:** use the explicit target, or the existing PR's actual base. If neither
  is known, resolve the intended train/master target using `docs/ecommerce/release.md`;
  ask when it cannot be determined. Fetch the selected base and compare from its
  merge base with the branch head.
- **Commit:** compare with the intended parent; clarify a merge commit's parent
  only if the request does not establish it.
- **Local changes:** include staged, unstaged and relevant untracked files. Use
  `git diff HEAD` plus `git ls-files --others --exclude-standard`; include the
  contents of new files, not only their names.
- **Named paths:** limit the review to those paths and relevant callers. If the
  user requested the current implementation rather than a diff, read it as such.

Record the repository, base, head and working-tree status. Capture the complete
changed-file inventory before filtering content, including deletions, both sides
of renames, binaries, generated files and lockfiles. An empty filtered code diff
is not an empty change. If there is genuinely no requested change, say so.

Read files and run checks at the reviewed revision. Use an isolated checkout
when the working tree is on another branch or contains unrelated work. Results
from another checkout do not validate the reviewed head.

## 2. Load the applicable rules and collect callouts

Read the docs mapped to the changed paths by `AGENTS.md` and
`.greptile/files.json`. Apply each scoped rule in `.greptile/config.json` only
where it matches. Resolve conflicting guidance against the implementation and
canonical docs; do not silently import Pubky App behaviour into Marketplace.

Record each applicable item for the report and PR template:

- **VRT:** changed visual surfaces, a sibling VRT, a scene under `src/test/vrt/`,
  or shared mocks/harness changes. Use `docs/visual-regression-testing.md` for
  Linux comparison and named baseline regeneration. A surface change needs an
  assessment; it does not automatically justify regenerating every baseline.
- **Database:** changes to the schema/index map, `DB_VERSION`, or database reset
  logic. Explain the actual upgrade/reset and local-data implications using
  `docs/data-patterns.md` and the Marketplace DB policy; do not claim every version
  bump wipes the database.
- **Product limits:** identify a real change to a product-wide limit in
  `src/config/`; merely touching a config file is not a policy change.
- **Dependencies:** changed package declarations, lockfile or vendored SDKs.
  Check existing equivalents, provenance and the paired App/Shop SDK requirements
  in `docs/ecommerce/release.md` when applicable.
- **Architecture:** new layers, stores, coordinators or cross-Application calls;
  identify the relevant ADR or the need for a new decision.
- **High-risk surfaces:** auth/session lifecycle, grants, private data, payment or
  order transitions, runtime configuration, service-worker output, network/error
  boundaries, generated files and CI workflows. Report the affected invariant
  and the checks that address it.
- **Copy/i18n:** reintroducing removed translation infrastructure or a parallel
  message registry; verify against the current copy convention.
- **Browser coverage:** affected Cypress specs, synthetic launch-critical flows,
  chat E2E or live release proof. Distinguish fixture tests from live service proof.
- **Documentation/changelog:** changes to a convention or API need updated docs;
  user-visible changes need a changelog fragment. Docs-only changes do not need
  product changelog entries.

Callouts are review obligations, not automatic defects or permission to perform
unrequested operations.

## 3. Review the complete change

Scale investigation and delegation to the risk. When useful, assign independent
read-only reviewers separate areas: architecture/project rules; correctness,
security and test coverage; reuse and unnecessary complexity. No fixed reviewer
count or finding quota is required. Without sub-agents, cover the same areas in
separate passes.

For every candidate finding:

1. Read the actual source, surrounding code and relevant callers.
2. Compare with the base to establish whether the change introduces or exposes
   the problem. Keep pre-existing issues separate.
3. Describe a concrete trigger and observable failure. Inspect type/null/error
   boundaries, async lifecycles, cache/session changes and rollback as applicable.
4. Check counterevidence. For unused code, search consumers and dynamic/config
   references; a missing text match alone is not proof.
5. Use a focused test or reproduction when it resolves uncertainty. If the claim
   cannot be established, label the missing evidence rather than present it as
   a confirmed regression.

Read all requested hunks. Do not exclude a file solely because it is generated
or large; inspect its source/provenance and consequential changes, and disclose
any limit. Prefer reuse of existing components, hooks, helpers, controllers and
pipes over parallel implementations. Respect the current Market toast API and
other documented feature-specific contracts unless the task explicitly changes them.

## 4. Verify at the reviewed revision

When the checkout has compatible dependencies, run `npm run lint` and
`npm run typecheck`; record the result and first actionable errors. If dependencies
are unavailable or incompatible, record the skipped check and why. Select further
checks from `docs/development-workflow.md` based on the change; do not describe a
suggested command as executed or a skipped job as a passed test.

Preserve the existing fast/full pre-push gate, Linux VRT and PR/merge-group checks.
A review's lint/typecheck pass does not replace pre-push or CI. Do not suppress,
weaken or bypass a failed check. Avoid live sign-in/payment/service operations
without the required task authorization and test environment. Synthetic launch
checks cannot certify the deployed grant-session release proof.

Re-read the final diff and reconcile all changed files with the applicable
rules and callouts. Fixes need fresh verification before a finding is resolved.

## 5. Report

Lead with the important findings and reviewed base/head. For each confirmed
finding, give severity, a precise file/line, the triggering scenario and impact,
and a concrete correction. Distinguish regressions, maintenance defects,
pre-existing issues and unresolved concerns. Deduplicate overlapping findings,
but do not cap or hide valid findings to fit a quota.

Then report:

- Actual checks and results, including skipped/failed checks and their reasons.
- Applicable VRT, schema, policy, dependency, ADR, browser and documentation callouts.
- Any material gaps in coverage or evidence.

If no actionable findings remain, say so plainly. Failed checks or unfulfilled
review obligations must be visible; do not automatically call a change ready to
merge based only on a finding count or green lint/typecheck. A merge recommendation
must consider required CI/reviews and the user's requested scope.
