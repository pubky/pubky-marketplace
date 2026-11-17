## Summary

<!-- Describe the concrete problem and resulting behaviour. Link the issue when applicable. -->

## Verification

<!-- Record what actually ran and its result. For skipped checks, explain why. Delete non-applicable lines. -->

- `npm run lint` / `npm run typecheck`:
- Unit tests (full or named files):
- `bash scripts/prepush.sh` (fast, or full for a release):
- Production build (route/config-wide changes):
- Linux VRT (affected scenes, or full suite for a shared harness change):
- Browser flows (synthetic, local-stack or live; name which):

## Callouts

<!-- Delete items that do not apply. These are review obligations, not instructions to change unrelated code. -->

- VRT baseline changes: named scenes, Linux regeneration and visual review; PNG-only commit.
- Database version/schema/index changes: intended upgrade/reset and local-data implications.
- Product-wide limits, dependencies, vendored SDKs or runtime configuration changes.
- Architectural decisions: ADR added/updated, or existing ADR followed.
- Convention changes: canonical docs, AGENTS and relevant tool/Greptile rules updated.
- Affected browser coverage: Cypress, launch-critical, chat or deployed release proof.
- User-visible change: `changelog.d/next/` fragment.

## Screenshots

<!-- Visible UI changes: desktop/mobile and relevant loading, empty and error states. -->
