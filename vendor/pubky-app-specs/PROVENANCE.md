# Vendored artifacts — do not edit

`npm pack` tarballs of the marketplace fork of `pubky-app-specs`, vendored so
`npm ci` needs no network fetch from a mutable source. The root `package.json`
pins one of them: `"pubky-app-specs": "file:vendor/pubky-app-specs/pubky-app-specs-0.6.2-marketplace.15.tgz"`.
Older tarballs stay for reference; only the pinned one is installed.

## Current pin: `0.6.2-marketplace.15`

- Source: `https://github.com/BitcoinErrorLog/pubky-app-specs`, tag
  `v0.6.2-marketplace.15`, commit `a49f4089ec18a883fcc28927c3b895adc1378403`
  (tree `cd27970a`, base tag `v0.6.2-marketplace.14`). The tag's tree is
  identical to the earlier unmerged SP1 build commit `695c0f7`
  (branch `reviews-sp1-spec-15`) this tarball was built from, so the sources
  are the same bytes and the tarball was not rebuilt.
- Contents: `.14` plus optional review text (0 to 5,000 characters), the
  per-item and seller counting keys, the optional `price_decade` purchase
  attestation claim and `price_weight()`. Details: `MARKETPLACE-FORK.md`,
  "Changes in `.15`", in the fork.
- Build: Rust 1.89.0, `wasm-pack` 0.13.1, `cargo run --bin bundle_specs_npm`,
  then `npm install`, `npm test` (60 passing) and `npm pack` in `pkg/`.
- Tarball sha512 (as recorded in `package-lock.json`):
  `eD4UGhVkVmqnOKTAj+znkSRC7+uT+eIoKv0QkWP2HI1ooskvbYAP/DCHh6wwXEMKHeU37pJMlorcGZzr1QyIwg==`.

To update, rebuild from the new fork commit, add the tarball here, point
`package.json` at it, run `npm install` to refresh `package-lock.json`, and
record the source here.
