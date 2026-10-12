# Contributing

Thanks for helping with the Pubky Shop. The rules live in the docs; this page points to them.

- **Set up, test and release:** [`docs/ecommerce/onboarding.md`](docs/ecommerce/onboarding.md) and [`docs/ecommerce/release.md`](docs/ecommerce/release.md).
- **Run it locally:** [`README.md`](README.md) and [`docs/ecommerce/RUNNING.md`](docs/ecommerce/RUNNING.md).
- **Architecture and conventions:** [`AGENTS.md`](AGENTS.md) and [`docs/`](docs/README.md). Read the page for the area you change before you change it.
- **Commits:** conventional commits, see [`docs/commit-message.md`](docs/commit-message.md).
- **Before every push:** `HUSKY=0 npm ci` once, then `bash scripts/prepush.sh`. Its last line on success starts with `PREPUSH OK`.
- **Visual regression tests:** a surface with a sibling `*.vrt.test.tsx` has a pixel baseline under `__screenshots__/`. If you change the surface, regenerate it with `VRT_LINUX_UPDATE=1 bash scripts/vrt-linux.sh <spec>` (needs Docker, see `docs/ecommerce/onboarding.md`) and say so in the pull request.
- **Questions and bugs:** [open an issue](https://github.com/pubky/pubky-marketplace/issues/new).
