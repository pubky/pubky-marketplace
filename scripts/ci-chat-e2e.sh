#!/usr/bin/env bash
# Run the two-account chat proof (src/test/e2e/chat-two-accounts.mjs) against
# a disposable local Pubky stack: the pubky-docker testnet (homeserver, pkarr
# and HTTP relays, Nexus, Homegate), a pubky/inbox container on the same
# network, and the Shop's production build served by `next start`.
#
# Needs: Docker with Compose, a `.next` production build in the working
# directory, `npm ci` done, and Playwright's Chromium (CHROMIUM_PATH or the
# Playwright-managed browser). Everything it starts is torn down on exit.
#
#   CHAT_E2E_INBOX_IMAGE   inbox image (default synonymsoft/pubky-inbox:v0.4.0)
#   CHAT_E2E_STACK_DIR     where pubky-docker is cloned (default .chat-e2e-stack)
#   CHAT_E2E_STACK_REF     pubky-docker ref to clone (default main)
#   CHAT_E2E_KEEP_STACK=1  leave the stack running for inspection
#   PORT                   Shop port (default 3000; the inbox CORS list and
#                          the e2e's SHOP_URL follow it)
set -euo pipefail

INBOX_IMAGE="${CHAT_E2E_INBOX_IMAGE:-synonymsoft/pubky-inbox:v0.4.0}"
STACK_DIR="${CHAT_E2E_STACK_DIR:-.chat-e2e-stack}"
STACK_REF="${CHAT_E2E_STACK_REF:-main}"
SHOP_PORT="${PORT:-3000}"
SHOP_URL="http://localhost:${SHOP_PORT}"
INBOX_URL="http://localhost:8088"
# Compose project name fixes the network name the inbox container joins.
COMPOSE_PROJECT="${CHAT_E2E_COMPOSE_PROJECT:-pubky-docker}"
INBOX_CONTAINER="chat-e2e-inbox"
SERVER_LOG="${CHAT_E2E_SERVER_LOG:-chat-e2e-server.log}"
SERVER_PID=""

log() { printf '[chat-e2e] %s\n' "$*"; }

cleanup() {
  local status=$?
  if (( status != 0 )); then
    log "failed (exit $status); last Shop server log lines:"
    tail -n 40 "$SERVER_LOG" 2>/dev/null || true
    log "stack containers:"
    docker ps -a --format '{{.Names}}\t{{.Status}}' 2>/dev/null || true
    log "inbox log:"
    docker logs --tail 40 "$INBOX_CONTAINER" 2>&1 || true
    log "nexusd log:"
    docker logs --tail 40 nexusd 2>&1 || true
  fi
  if [[ -n "$SERVER_PID" ]]; then
    # `npm run start` spawns `next start`: kill the whole process group (setsid
    # above made npm its leader) so no server outlives the script on the port.
    kill -- -"$SERVER_PID" 2>/dev/null || kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ "${CHAT_E2E_KEEP_STACK:-}" != "1" ]]; then
    docker rm -f "$INBOX_CONTAINER" >/dev/null 2>&1 || true
    if [[ -f "$STACK_DIR/docker-compose.yml" ]]; then
      (cd "$STACK_DIR" && docker compose -p "$COMPOSE_PROJECT" --profile backend down -v --remove-orphans >/dev/null 2>&1) || true
    fi
  fi
  exit "$status"
}
trap cleanup EXIT

wait_http() {
  # wait_http <url> <label> <seconds>: any HTTP answer counts, a closed port does not.
  local url="$1" label="$2" budget="$3" waited=0 code
  while :; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" || true)"
    if [[ "$code" != "000" ]]; then
      log "$label is up at $url ($code after ${waited}s)"
      return 0
    fi
    if (( waited >= budget )); then
      log "$label did not answer at $url within ${budget}s"
      return 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
}

# 1. The testnet stack (images are public; nothing is built).
if [[ ! -f "$STACK_DIR/docker-compose.yml" ]]; then
  log "cloning pubky/pubky-docker@$STACK_REF into $STACK_DIR"
  git clone --quiet --depth 1 --branch "$STACK_REF" https://github.com/pubky/pubky-docker.git "$STACK_DIR"
fi
(
  cd "$STACK_DIR"
  if [[ ! -f .env ]]; then
    sed 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=backend/' .env-sample > .env
  fi
  # The current pubky-nexus image reads `testnet` under [watcher]; the stack's
  # testnet config still only has it under [stack.net], and nexusd exits at
  # start ("missing field `testnet`"). Add the two keys until pubky-docker does.
  if ! awk '/^\[watcher\]/{w=1;next} /^\[/{w=0} w&&/^testnet *=/{f=1} END{exit !f}' pubky-nexus-config-testnet.toml; then
    sed -i 's/^\[watcher\]$/[watcher]\ntestnet = true\ntestnet_host = "homeserver"/' pubky-nexus-config-testnet.toml
  fi
  docker compose -p "$COMPOSE_PROJECT" --profile backend up -d --no-build --quiet-pull
)
wait_http "http://localhost:6286/" "homeserver" 180
wait_http "http://localhost:15411/" "pkarr relay" 60
# Nexus has no restart policy and its compose dependency on Neo4j is not a
# health wait: on a cold graph it can start before Neo4j accepts connections
# and exit. Wait for Neo4j, then make sure nexusd is up, restarting it if not.
wait_http "http://localhost:7474/" "neo4j" 240
for _ in $(seq 1 12); do
  if [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:8080/v0/info || true)" == "200" ]]; then break; fi
  if [[ "$(docker inspect -f '{{.State.Running}}' nexusd 2>/dev/null)" != "true" ]]; then
    log "nexusd is not running; starting it again"
    (cd "$STACK_DIR" && docker compose -p "$COMPOSE_PROJECT" --profile backend up -d --no-build nexusd >/dev/null 2>&1) || true
  fi
  sleep 10
done
wait_http "http://localhost:8080/v0/info" "nexus" 60

# 2. The inbox: its own database on the stack's Postgres, same network.
for _ in $(seq 1 30); do
  if docker exec postgres pg_isready -U test_user -d pubky_homeserver >/dev/null 2>&1; then break; fi
  sleep 2
done
if ! docker exec postgres psql -U test_user -d pubky_homeserver -Atc "SELECT 1 FROM pg_database WHERE datname = 'inbox'" | grep -q 1; then
  docker exec postgres psql -U test_user -d pubky_homeserver -c 'CREATE DATABASE inbox' >/dev/null
fi
docker rm -f "$INBOX_CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$INBOX_CONTAINER" --network "${COMPOSE_PROJECT}_pubky" -p 8088:8080 \
  -e INBOX_DATABASE__URL=postgres://test_user:test_pass@postgres:5432/inbox \
  -e "INBOX_AUTH__AUDIENCE=$INBOX_URL" \
  -e "INBOX_SERVER__CORS_ALLOWED_ORIGINS=[\"$SHOP_URL\"]" \
  "$INBOX_IMAGE" >/dev/null
wait_http "$INBOX_URL/v1/health/ready" "inbox" 90

# 3. The Shop, production build, configured for the stack. `next start` requires
#    the whole runtime set (see scripts/ci-launch-e2e.sh); the sandbox commerce
#    mode needs no transaction service.
test -f .next/BUILD_ID || { log "no .next production build; run npm run build first"; exit 1; }
PUBKY_RUNTIME_ENV=production \
PUBKY_RUNTIME_TESTNET=true \
PUBKY_RUNTIME_HOMESERVER=8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo \
PUBKY_RUNTIME_HOMESERVER_URL=http://localhost:6286 \
PUBKY_RUNTIME_NEXUS_URL=http://localhost:8080 \
PUBKY_RUNTIME_CDN_URL=http://localhost:8080/static \
PUBKY_RUNTIME_HOMEGATE_URL=http://localhost:6300 \
PUBKY_RUNTIME_PKARR_RELAYS='["http://localhost:15411"]' \
PUBKY_RUNTIME_DEFAULT_HTTP_RELAY=http://localhost:15412/link/ \
PUBKY_RUNTIME_EXCHANGE_RATE_API=https://api1.blocktank.to/api/fx/rates/btc \
PUBKY_RUNTIME_COMMERCE_ADAPTER_MODE=sandbox \
PUBKY_RUNTIME_MARKETPLACE_URL=https://marketplace.invalid \
PUBKY_RUNTIME_INBOX_URL="$INBOX_URL" \
PUBKY_RUNTIME_INBOX_AUDIENCE="$INBOX_URL" \
PORT="$SHOP_PORT" setsid npm run start >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!
wait_http "$SHOP_URL/" "Shop" 120

# 4. The proof.
SHOP_URL="$SHOP_URL" \
HOMESERVER_ADMIN_URL=http://localhost:6288/generate_signup_token \
HOMESERVER_ADMIN_PASSWORD=admin \
node src/test/e2e/chat-two-accounts.mjs
