# Contributing

Thanks for helping with Pubky Market. The rules live in the docs; this page points to them.

- **Set up, test and release:** [`docs/ecommerce/onboarding.md`](docs/ecommerce/onboarding.md) and [`docs/ecommerce/release.md`](docs/ecommerce/release.md).
- **Run it locally:** [`README.md`](README.md) and [`docs/ecommerce/RUNNING.md`](docs/ecommerce/RUNNING.md).
- **Architecture and conventions:** [`AGENTS.md`](AGENTS.md) and [`docs/`](docs/README.md). Read the page for the area you change before you change it.
- **Working on a change:** [`docs/development-workflow.md`](docs/development-workflow.md); reuse existing patterns, keep scope coherent, and verify at the right level.
- **Commits and PRs:** conventional commits and draft PRs by default; see [`docs/commit-message.md`](docs/commit-message.md) and [the PR template](.github/PULL_REQUEST_TEMPLATE.md).
- **Local review:** the shared [`pubky-code-review` skill](.agents/skills/pubky-code-review/SKILL.md) reviews the actual PR base and records checks and callouts.
- **Before every push:** `HUSKY=0 npm ci` once, then `bash scripts/prepush.sh`. Its last line on success starts with `PREPUSH OK`.
- **Visual regression tests:** a surface with a sibling `*.vrt.test.tsx` has a pixel baseline under `__screenshots__/`. If you change the surface, regenerate it with `VRT_LINUX_UPDATE=1 bash scripts/vrt-linux.sh <spec>` (needs Docker, see `docs/ecommerce/onboarding.md`) and say so in the pull request.
- **Questions and bugs:** [open an issue](https://github.com/pubky/pubky-marketplace/issues/new).
