#!/usr/bin/env bash
# Decide whether the launch-e2e job runs.
#
# The explicit synthetic SDK protocol gate uses only public test keys and
# runs for every pull request. Optional live staging runs require the seller
# secret; same-repo live runs must fail rather than silently skip if missing.
set -euo pipefail

secret="${LAUNCH_E2E_SELLER_SECRET_HEX:-}"
head_repo="${LAUNCH_E2E_HEAD_REPO:-}"
base_repo="${LAUNCH_E2E_BASE_REPO:-}"

emit() {
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s\n' "$1" >>"$GITHUB_OUTPUT"
  fi
}

mode="${LAUNCH_E2E_MODE:-live}"
if [[ "$mode" == "synthetic" ]]; then
  emit "run=true"
  exit 0
fi
if [[ "$mode" != "live" ]]; then
  echo "::error title=launch-e2e::LAUNCH_E2E_MODE must be synthetic or live."
  exit 1
fi

if [[ -n "$secret" ]]; then
  emit "run=true"
  exit 0
fi

if [[ -n "$head_repo" && -n "$base_repo" && "$head_repo" != "$base_repo" ]]; then
  emit "run=false"
  echo "::notice title=launch-e2e skipped::Fork pull request from ${head_repo} does not receive LAUNCH_E2E_SELLER_SECRET_HEX. launch-e2e did not run. Same-repo pull requests still fail when this secret is missing."
  exit 0
fi

echo "::error title=launch-e2e::LAUNCH_E2E_SELLER_SECRET_HEX is missing. This same-repo pull request must run launch-e2e; the job does not skip."
exit 1
