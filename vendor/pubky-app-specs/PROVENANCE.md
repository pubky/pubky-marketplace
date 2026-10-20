# Vendored artifacts — do not edit

`npm pack` tarballs of the marketplace fork of `pubky-app-specs`, vendored so
`npm ci` needs no network fetch from a mutable source. The root `package.json`
pins one of them: `"pubky-app-specs": "file:vendor/pubky-app-specs/pubky-app-specs-0.6.2-marketplace.13.tgz"`.
Older tarballs stay for reference; only the pinned one is installed.

## Current pin: `0.6.2-marketplace.14`

- Source: `marketplace-4-build` (`.13`, `708609c`) plus one commit,
  `5a8f3052b8a134b60b0c326f045819e2e9267893` (`ovitrif/pubky-app-specs`,
  branch `feat/review-per-order`, proposed to `BitcoinErrorLog/pubky-app-specs`):
  the review record's optional `orderRef`, hashed into the review ID so each
  attested order keeps its own review. Details: `MARKETPLACE-FORK.md`,
  "Changes in `.14`", in the fork.
- Build: Rust 1.99.1, `wasm-pack` 0.13.1, `cargo run --bin bundle_specs_npm`,
  then `npm install`, `npm test` (55 passing) and `npm pack` in `pkg/`.
- Tarball sha512 (as recorded in `package-lock.json`):
  `UWIe9SVnn/qXgJEtg1wMuY7XxMuC3zxnj4EZFQNpllx5XVNLgPR48yp7tWujy4M37rmcGBzMVajiAS/sliC7xQ==`.

To update, rebuild from the new fork commit, add the tarball here, point
`package.json` at it, run `npm install` to refresh `package-lock.json`, and
record the source here.
