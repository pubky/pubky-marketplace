# Vendored artifacts — do not edit

`npm pack` tarballs of the marketplace fork of `pubky-app-specs`, vendored so
`npm ci` needs no network fetch from a mutable source. The root `package.json`
pins one of them: `"pubky-app-specs": "file:vendor/pubky-app-specs/pubky-app-specs-0.6.2-marketplace.13.tgz"`.
Older tarballs stay for reference; only the pinned one is installed.

## Current pin: `0.6.2-marketplace.14`

- Source: `https://github.com/BitcoinErrorLog/pubky-app-specs`, tag
  `v0.6.2-marketplace.14`, commit `30643e602e8979630f9b486db76972e60fdbd134`.
- Contents: `.13` plus BitcoinErrorLog/pubky-app-specs#5: the review
  record's optional `orderRef`, hashed into the review ID so each attested
  order keeps its own review, and the one-count-per-attested-order rule with
  its helpers. Details: `MARKETPLACE-FORK.md`, "Changes in `.14`", in the fork.
- Build: Rust 1.99.1, `wasm-pack` 0.13.1, `cargo run --bin bundle_specs_npm`,
  then `npm install`, `npm test` (55 passing) and `npm pack` in `pkg/`.
- Tarball sha512 (as recorded in `package-lock.json`):
  `FwWayv6MT45DEozz96dhvBu4lc9falebhaBojrLtl+FgeS0P1bZob0bpjACl0eZd6LV08JLDLjR8Foj/G1P7Mg==`.

To update, rebuild from the new fork commit, add the tarball here, point
`package.json` at it, run `npm install` to refresh `package-lock.json`, and
record the source here.
