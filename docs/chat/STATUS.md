# Chat rewrite — status and resume notes

> Working log for the buyer↔seller messaging rewrite (branch `cc/pubky-messaging-rewrite-96c7a7`).
> This file is the resume point across work sessions. Design reference: the approved plan
> (`~/.claude/plans/ok-we-have-a-glistening-coral.md`) and, once written, `docs/chat/README.md`.
> Trim or fold into README.md before the PR merges.

## Current step

**Core, UI, SDK 0.16 bump and both live two-account proofs (cookie and grant + inbox pings) done.** Next action: stale sign-in copy (`SignIn.tsx` "Messages are not available with Passport sign-ins yet", reauth/connect dialog `messages` intent), sandbox-mode entry-point check (listing/order CTAs), docs (README, ADR, changelog), VRT baselines, full `npm test`/lint/format, handoff.

## Progress

| Step                                                                                                                     | Status | Commit                   |
| ------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------ |
| P0 Old UI screenshots sent to Matthew (21 VRT baselines)                                                                 | done   | —                        |
| P0 `npm install`, baseline typecheck/test (1119 files / 17756 tests green)                                               | done   | 0a5098b3a                |
| P1.1 Extract `hasPaymentRequestReceiver` → `paykit-receiver.ts`; move retry-backoff/pass-deadline to `libs/chat`         | done   | 9854ab6d9                |
| P1.2 UI detach (routes, templates, organisms, hooks, VRT, live tests, entry points → `ChatEntryButton`)                  | done   | (next commit)            |
| P1.3a Delete messaging core, Dexie 9 drops `commerce_messaging_*`, adds `chat_*` (schema only), auth/DB provider cleanup | done   | (next commit)            |
| P1.3b Add libs/chat, models, services, application, controller, store; capabilities `/pub/chat:rw,/priv/chat:rw`         | done   | da5306973, 9e2bb0d8f     |
| P1.4 Inbox service + ChatSyncCoordinator                                                                                 | done   | b20cbbb15                |
| P1.5 UI (hooks, organisms, templates, pages); VRT suites still todo                                                      | done   | f2c7277b1                |
| P2 SDK 0.16 minimal bump + real `createInboxCredentials`; grant flow on the facade client; inbox slot fix                | done   | 8493c562f, (next commit) |
| P2 Merge Vlada's grant PR when it lands                                                                                  | todo   |                          |
| P4 Docs (README, ADR 0030, status/FEATURES/RUNNING/environment/threat-model, changelog)                                  | todo   |                          |
| V1 Unit suites green, typecheck, lint, format                                                                            | todo   |                          |
| V2 Live two-account proof, cookie mode (`npm run test:e2e:chat`, 13/13) and grant mode (`CHAT_E2E_AUTH=grant`, 16/16)    | done   | 2d93aac6e, (next commit) |
| V3 Real-browser two-tab session with screenshots                                                                         | todo   |                          |
| V4 Cypress + VRT updates                                                                                                 | todo   |                          |
| V5 Regression (must-not-break list)                                                                                      | todo   |                          |
| Handoff to Matthew for manual QA                                                                                         | todo   |                          |

## Waiting on others

| #   | Item                                                                                                         | Owner                 | Status                           |
| --- | ------------------------------------------------------------------------------------------------------------ | --------------------- | -------------------------------- |
| 1   | Inbox CORS for `http://localhost:3000`, staging Shop host, `https://pubky.app` / `https://staging.pubky.app` | Severin               | asked                            |
| 2   | Staging/prod inbox deployment + audience                                                                     | Severin               | asked                            |
| 3   | Shop SDK 0.16 + grant-only sign-in PR                                                                        | Vlada                 | due 2026-10-13; we merge it in   |
| 4   | pubky.app SDK 0.16 bump together with the Shop for `/shop` same-origin embedding                             | pubky-app maintainers | to raise                         |
| 5   | Inbox multi-device semantics (pings = wake-ups only)                                                         | Severin               | FYI                              |
| 6   | Staging signup tokens for two test accounts                                                                  | Matthew               | optional (local testnet default) |

## Gotchas / decisions taken mid-way

- Sandbox transaction-service messaging (`services/marketplace/*`, `message.send`, `buildMarketplaceConversationAggregateId`, `sendMarketplaceMessageCommandSchema`) was left in place: the sandbox server tests still use it and nothing in the client calls it. Remove later if wanted.
- `MarketplaceReauthDialog`/`MarketplaceSessionConnectDialog` keep an `intent="messages"` variant; reuse it for the chat `needs_reauth` state.
- `message_received` notifications now deep-link to `/messages` (no per-thread aggregate id in the new model).
- Test-file lint bans `as unknown as T`; use `asOpaque<T>()` from `@/test-utils/type-assertions`.
- Nav VRT scenarios moved to `src/test/vrt/navigation/NavBadges.vrt.test.tsx` (baselines renamed with the folder; expect a regen).
- `NEXT_PUBLIC_DB_VERSION` must be 9 everywhere (env default, `.env.example`, Docker workflows): with an older declared version the `chat_*` tables are not declared and `db.table('chat_identity')` throws at import time (SSR 500). Vercel env for staging/prod needs the same bump.
- Dexie `where(compound).between().reverse().limit()` returned pages out of order in Chromium; `LocalChatService.listMessages` sorts explicitly.
- Never nest `runInOneTab` with the same lock name: the inner `ifAvailable` request sees the lock held and skips (bit the new-device rebuild).
- Playwright refuses `npx playwright install` on this Ubuntu; the e2e script takes `CHROMIUM_PATH` (e.g. `~/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`).
- Local Nexus (pubky-docker) needed `testnet = true` and `testnet_host = "homeserver"` under `[watcher]` in `pubky-nexus-config-testnet.toml` for the current image; edited in Matt's checkout (uncommitted, tell him).
- The Shop's dev signup-token route needs `HOMESERVER_ADMIN_URL=http://localhost:6288/generate_signup_token` and `HOMESERVER_ADMIN_PASSWORD=admin` (set in `.claude/launch.json`, gitignored).
- Cookie sessions (Ring today) cannot get an inbox session (`needs_grant`); chat still works through streams + reconciliation. Stranger first contact needs the inbox.
- Grant sign-in must start on the facade (`getPubkySdk().startGrantAuthFlow`), not the static `GrantAuthFlow.startDelegated`: the static call spins up a default mainnet DHT client that cannot resolve testnet identities (and ignores custom pkarr relays). Symptom: "could not resolve homeserver for <pubky>" right after the signer approves.
- Inbox ping slots are 1–64 Base64url characters: the slot is `chat-<folder>` (`chatPingSlot`), not `chat:<folder>` (the inbox answered 400 `invalid_slot`).
- The ring simulator's `node_modules` can lag its lockfile (had SDK 0.11 installed with 0.15 pinned, so grant links were approved with the wrong protocol). `npm ci` in `/home/mk/CODE/pubky-ring-simulator` and clear `node_modules/.vite` before `npm run dev`. The simulator approves grant links through a real paste event; a synthetic `ClipboardEvent('paste')` on `#shortcut-auth-input` works.
- The Node SDK signer approves `signin_grant` links too, so the e2e runs the Bitkit path without the simulator (`CHAT_E2E_AUTH=grant`).
- A hard navigation while the inbox long-poll is in flight logs one `Err.network` ("Chat inbox poll failed") from the unloading page; client-side route changes do not. Shared `safeFetch` behaviour, left as is.

## How to resume

```bash
# 1. Orientation
git log --oneline -20 && git status
# 2. App deps (worktree has its own node_modules)
npm install
npm run typecheck && npm test
# 3. Local stack (homeserver + pkarr + nexus + homegate)
cd /home/mk/CODE/pubky-docker && git pull && docker compose --profile backend up -d
# 4. Local inbox (clone pubky/inbox, build its Dockerfile; Postgres from postgres:17-alpine)
#    env: INBOX_AUTH__AUDIENCE=http://localhost:8080 INBOX_SERVER__CORS_ALLOWED_ORIGINS=["http://localhost:3000"]
# 5. Ring simulator for approving sign-in QRs with disposable identities
cd /home/mk/CODE/pubky-ring-simulator && npm run dev
# 4b. Local inbox container (image built from the pubky/inbox Dockerfile as pubky-inbox:dev)
docker run -d --name pubky-inbox-dev --network pubky-docker_pubky -p 8088:8080 \
  -e INBOX_DATABASE__URL=postgres://test_user:test_pass@postgres:5432/inbox -e INBOX_AUTH__AUDIENCE=http://localhost:8088 \
  -e 'INBOX_SERVER__CORS_ALLOWED_ORIGINS=["http://localhost:3000"]' -v pubky-inbox-dev-data:/data pubky-inbox:dev
# 5b. Two-account proof (dev server + homeserver running); grant mode also needs the inbox container
CHROMIUM_PATH=~/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell npm run test:e2e:chat
CHAT_E2E_AUTH=grant CHROMIUM_PATH=~/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell npm run test:e2e:chat
# 6. The app against the local stack (see .env.example "Local testnet example")
PUBKY_RUNTIME_TESTNET=true PUBKY_RUNTIME_HOMESERVER=8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo \
PUBKY_RUNTIME_HOMESERVER_URL=http://localhost:6286 PUBKY_RUNTIME_NEXUS_URL=http://localhost:8080 \
PUBKY_RUNTIME_CDN_URL=http://localhost:8080/static PUBKY_RUNTIME_DEFAULT_HTTP_RELAY=http://localhost:15412/inbox/ \
PUBKY_RUNTIME_INBOX_URL=http://localhost:8088 PUBKY_RUNTIME_INBOX_AUDIENCE=http://localhost:8088 npm run dev
```
