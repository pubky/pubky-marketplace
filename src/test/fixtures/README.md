# `src/test/fixtures/`

**Static, deterministic data shaped to match production types.**

Contents are pure values — no functions, no `vi.fn()`, no module-graph side
effects. A fixture file describes the _world_ a test runs against; how the test
actually consumes that world (mocking a hook, intercepting `fetch`, seeding a
store) lives elsewhere — see `../mocks/`.

## Why a separate folder

- **Reuse across mocks.** The same fixture set can power multiple mocks
  across component and application tests. Fixtures and mocks are
  1:N, not 1:1, so they don't belong in the same file.
- **Type-checked stability.** Fixtures are typed with the real Nexus / model
  schemas. If the production type drifts, TypeScript flags every fixture before
  any test runs.
- **Visual regression source-of-truth.** VRT screenshots are pixel-accurate
  derivatives of these values. Anything that varies per run (timestamps,
  random IDs, network avatars) must not appear here. Use the shared clock in
  `src/test-utils/vrt.clock.ts`.

## Conventions

- Filenames map to the rendered surface, not the producer (for example, `shopify/product-current.csv`).
- Visual fixture exports are prefixed `VRT_` so the test harness origin is
  obvious at every call site.
