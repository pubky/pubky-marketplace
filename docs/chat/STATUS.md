# Chat rewrite — status and resume notes

> Working log for the buyer↔seller messaging rewrite (branch `cc/pubky-messaging-rewrite-96c7a7`).
> This file is the resume point across work sessions. Design reference: the approved plan
> (`~/.claude/plans/ok-we-have-a-glistening-coral.md`) and, once written, `docs/chat/README.md`.
> Trim or fold into README.md before the PR merges.

## Current step

**Phase 1: rip-out done (steps 1–3 deletions), chat core next.** Next action: Phase 1.3 "add" part — `src/libs/chat/*` (paths, schemas, crypto), models, `ChatHomeserverService`, `LocalChatService`, `ChatApplication`, `ChatController`, store; then Phase 1.4 inbox + coordinator; then Phase 1.5 UI.

## Progress

| Step                                                                                                                     | Status | Commit        |
| ------------------------------------------------------------------------------------------------------------------------ | ------ | ------------- |
| P0 Old UI screenshots sent to Matthew (21 VRT baselines)                                                                 | done   | —             |
| P0 `npm install`, baseline typecheck/test (1119 files / 17756 tests green)                                               | done   | 0a5098b3a     |
| P1.1 Extract `hasPaymentRequestReceiver` → `paykit-receiver.ts`; move retry-backoff/pass-deadline to `libs/chat`         | done   | 9854ab6d9     |
| P1.2 UI detach (routes, templates, organisms, hooks, VRT, live tests, entry points → `ChatEntryButton`)                  | done   | (next commit) |
| P1.3a Delete messaging core, Dexie 9 drops `commerce_messaging_*`, adds `chat_*` (schema only), auth/DB provider cleanup | done   | (next commit) |
| P1.3b Add libs/chat, models, services, application, controller, store; capabilities `/pub/chat:rw,/priv/chat:rw`         | todo   |               |
| P1.4 Inbox service + ChatSyncCoordinator                                                                                 | todo   |               |
| P1.5 UI (hooks, organisms, templates, pages, VRT)                                                                        | todo   |               |
| P2 SDK 0.16 minimal bump + real `createInboxCredentials`; merge Vlada's grant PR when it lands                           | todo   |               |
| P4 Docs (README, ADR 0030, status/FEATURES/RUNNING/environment/threat-model, changelog)                                  | todo   |               |
| V1 Unit suites green, typecheck, lint, format                                                                            | todo   |               |
| V2 Live two-account browser test (`npm run test:chat:live`)                                                              | todo   |               |
| V3 Real-browser two-tab session with screenshots                                                                         | todo   |               |
| V4 Cypress + VRT updates                                                                                                 | todo   |               |
| V5 Regression (must-not-break list)                                                                                      | todo   |               |
| Handoff to Matthew for manual QA                                                                                         | todo   |               |

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
# 6. The app against the local stack (see .env.example "Local testnet example")
PUBKY_RUNTIME_TESTNET=true PUBKY_RUNTIME_HOMESERVER=8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo \
PUBKY_RUNTIME_HOMESERVER_URL=http://localhost:6286 PUBKY_RUNTIME_NEXUS_URL=http://localhost:8080 \
PUBKY_RUNTIME_CDN_URL=http://localhost:8080/static PUBKY_RUNTIME_DEFAULT_HTTP_RELAY=http://localhost:15412/inbox/ \
PUBKY_RUNTIME_INBOX_URL=http://localhost:8080 PUBKY_RUNTIME_INBOX_AUDIENCE=http://localhost:8080 npm run dev
```
