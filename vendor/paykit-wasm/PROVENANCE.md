# Vendored artifact — do not edit

Generated `wasm-pack` output of the paykit-wasm browser binding (the Paykit
Encrypted Link messaging surface), vendored verbatim so `npm ci` needs no
network fetch from a mutable source. Referenced from the root `package.json`
as `"paykit-wasm": "file:vendor/paykit-wasm"`.

- Source: `https://github.com/BitcoinErrorLog/paykit-rs-official`, commit
  `d4a73a5765e1f0b18ed451d78f98dab97c611a8c` on `master` (`0.1.0-rc50`),
  package path `paykit-wasm/pkg`.
- Full provenance (toolchain, generation command, checksums, re-vendoring
  steps): [`docs/ecommerce/paykit-wasm-provenance.md`](../../docs/ecommerce/paykit-wasm-provenance.md).
- Known differences from paykit-rs v0.1.0: see the
  [parser error-message note and next re-vendor plan](../../docs/ecommerce/paykit-wasm-provenance.md#known-differences-from-paykit-rs-v010).
- Guarded in CI by `scripts/paykit-wasm-smoke.mjs` (see `.github/workflows/build.yml`).

Never modify these files by hand. To update, rebuild from the pinned (or newly
pinned) source commit and re-record provenance.
