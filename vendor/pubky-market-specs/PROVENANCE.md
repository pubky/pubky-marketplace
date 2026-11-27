# Market specs npm package

The Shop uses the npm bindings from `pubky-market-specs` v0.2.0. The Rust release
contains the source and the npm packager. The upstream tag points to commit
`22b394690a8296cdecb9f43bcbe4f831da1220cb`.
[Release source](https://github.com/pubky/pubky-market-specs/tree/v0.2.0)

To reproduce the package, check out that tag, install Rust 1.89.0 with the
`wasm32-unknown-unknown` target and wasm-pack 0.15.1, then run the following
from the source checkout.

```sh
cargo run --locked --bin bundle_specs_npm
cd pkg
npm install
npm test
npm pack
```

The root `package-lock.json` records the SHA-512 integrity of the packed
artifact. The package provides both the browser bindings and the Node bindings.
