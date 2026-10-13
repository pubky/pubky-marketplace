# Vendored artifacts — do not edit

`npm pack` tarballs of the marketplace fork of `pubky-app-specs`, vendored so
`npm ci` needs no network fetch from a mutable source. The root `package.json`
pins one of them: `"pubky-app-specs": "file:vendor/pubky-app-specs/pubky-app-specs-0.6.2-marketplace.13.tgz"`.
Older tarballs stay for reference; only the pinned one is installed.

## Current pin: `0.6.2-marketplace.13`

- Source: `https://github.com/BitcoinErrorLog/pubky-app-specs`, tag
  `v0.6.2-marketplace.13`, commit `708609ccc11f196819d6fd5140f0aea019c9e81a`.
- Contents: `marketplace-4-build` at the merge of fork PR #4 (`cf1fa02`, seller-set
  `deliveryAssumeDays` / `autoCompleteDays` on the shop record) plus the
  `shipping` fulfillment method, `digitalLock` optional with `digital`
  fulfillment, and the `pubky-priv-aead/v1` specification text, which the
  Nexus-pinned line (`2f2797a8`) carried and `marketplace-4-build` did not.
  Details: `MARKETPLACE-FORK.md`, "Changes in `.13`", in the fork.
- Build: Rust 1.89, `wasm-pack` 0.13.1, `cargo run --bin bundle_specs_npm`,
  then `npm install`, `npm test` (55 passing) and `npm pack` in `pkg/`.
- Tarball sha512 (as recorded in `package-lock.json`):
  `aMFb+839EstiOiN+VnRYaiWIqye7S90tic7x4bc98XZm/xR1OytZVq2QTMJC0ZzmALvNwa/5t8c63ZrvltVygQ==`.

To update, rebuild from the new fork commit, add the tarball here, point
`package.json` at it, run `npm install` to refresh `package-lock.json`, and
record the source here.
