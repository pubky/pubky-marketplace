# Vendored artifacts — do not edit

`npm pack` tarballs of the marketplace fork of `pubky-app-specs`, vendored so
`npm ci` needs no network fetch from a mutable source. The root `package.json`
pins one of them: `"pubky-app-specs": "file:vendor/pubky-app-specs/pubky-app-specs-0.6.2-marketplace.15.tgz"`.
Older tarballs stay for reference; only the pinned one is installed.

## Current pin: `0.6.2-marketplace.15` (unmerged SP1 build)

- Source: `https://github.com/BitcoinErrorLog/pubky-app-specs`, branch
  `reviews-sp1-spec-15`, commit `695c0f7af3ac02e1b726d8a82eee17f114d2da59`
  (base tag `v0.6.2-marketplace.14`). The `v0.6.2-marketplace.15` tag does not
  exist yet: this tarball is built from the unmerged SP1 commit.
- Contents: `.14` plus optional review text (0 to 5,000 characters), the
  per-item and seller counting keys, the optional `price_decade` purchase
  attestation claim and `price_weight()`. Details: `MARKETPLACE-FORK.md`,
  "Changes in `.15`", in the fork.
- Build: Rust 1.89.0, `wasm-pack` 0.13.1, `cargo run --bin bundle_specs_npm`,
  then `npm install`, `npm test` (60 passing) and `npm pack` in `pkg/`.
- Tarball sha512 (as recorded in `package-lock.json`):
  `eD4UGhVkVmqnOKTAj+znkSRC7+uT+eIoKv0QkWP2HI1ooskvbYAP/DCHh6wwXEMKHeU37pJMlorcGZzr1QyIwg==`.
- When SP1 merges, rebuild from the `v0.6.2-marketplace.15` tag and replace
  this tarball. Keep the file name unchanged only if the bytes are identical;
  otherwise refresh the sha512 here and in `package-lock.json`.

To update, rebuild from the new fork commit, add the tarball here, point
`package.json` at it, run `npm install` to refresh `package-lock.json`, and
record the source here.
