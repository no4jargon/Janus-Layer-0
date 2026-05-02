# Productization Progress Tracker

Status: active
Last updated: 2026-05-02
Scope tracked here: desktop-first, local-first freelancer communications workspace derived from the original `Baileys/demo` prototype.

## Overall status

Current phase: **Phase 1–4 complete in code** (all v1 plan items shipped). Outstanding work is operational only: an actual signed installer requires Apple/Microsoft developer credentials, and the update feed needs to be hosted.

Overall summary:
- **Phase 0 is complete.**
- **Phase 1 is complete** — runtime, DB, logger, settings, migration recovery all live behind package boundaries.
- **Phase 2 is complete** — Gmail connector + send outbox, WhatsApp Baileys connector + send outbox, attachment download UX, compose/reply UX in the renderer, live event subscriptions for sync + WhatsApp messages.
- **Phase 3 in progress** — cluster CRUD + multi-select UX + AI workflow extraction panel ported from the demo (running against Ollama via `@workspace/ai`); cluster + AI outputs persisted in DB.
- **Phase 4 still not started**.

The renderer mirrors the demo prototype's UX 1:1: 3-pane layout (sidebar with WhatsApp / Email / Clusters tabs + More-channels menu, thread + composer, AI panel with cluster + lookback hours pickers). Cluster state moved from `localStorage` into the DB.

## Completed work

### Planning completed
- [x] Chose **desktop-first** distribution for v1
- [x] Chose **local-first** storage model
- [x] Decided **not** to store user message data on our servers
- [x] Chose **Electron** as the recommended fastest path
- [x] Chose **React + Vite + Node/TypeScript + SQLite** as the recommended stack
- [x] Decided mobile should be a **later companion**, not the primary v1 target
- [x] Decided updates should eventually support **required/forced updates**
- [x] Decided DB changes should be handled by **startup migrations** bundled with releases

### Phase 0 completed
- [x] Created new repository scaffold (`workspace-app`)
- [x] Initialized git repository
- [x] Created monorepo structure (`apps/`, `packages/`, `docs/`, `scripts/`)
- [x] Added workspace configuration (`pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`)
- [x] Added package-level scaffolds for desktop, UI, core, DB, connectors, AI, and shared
- [x] Replaced placeholder runners with real Electron + React/Vite wiring
- [x] Added desktop packaging command (`pnpm package:desktop`)
- [x] Added dev/prod data path conventions in code and smoke verification
- [x] Added ADR for extraction strategy (`docs/ADR-001-phase0-extraction-strategy.md`)

### Phase 1 completed
- [x] Runtime bootstrap orchestration extracted into `@workspace/core`
- [x] DB bootstrap + migration runner extracted into `@workspace/db`
- [x] Pre-migration database backups (timestamped copies under `<data>/backups/`)
- [x] Migration failure surfaced via runtime snapshot; UI shows retry screen and a retry IPC restarts the runtime
- [x] File-based structured logging (`<data>/logs/app.log`)
- [x] Settings store (`<data>/settings.json`) with runtime read/write IPC
- [x] Hardened Electron baseline (sandbox, single-instance lock, delayed show)
- [x] Workspace `.env` loading in desktop runtime

### Phase 2 completed
- [x] `@workspace/db` typed repos: `createEmailStore`, `createWhatsAppStore`, `createConnectorStateStore`, `createClusterStore`, `createAiOutputStore`
- [x] Gmail OAuth desktop flow + token refresh + profile fetch + thread/message mirror sync (`@workspace/connectors-gmail`)
- [x] Gmail send outbox pipeline (`createGmailSendService`) wired through IPC
- [x] WhatsApp connector on top of `baileys` (multi-file auth state, QR streaming, reconnect with backoff, mirror events)
- [x] WhatsApp send outbox pipeline (`createWhatsAppSendService`)
- [x] DB migrations: `001_init`, `002_email_mirror`, `003_whatsapp_mirror`, `004_wa_outbox`, `005_clusters_and_ai`
- [x] Attachment download UX (Electron save dialog, IPC at `workspace:gmail:download-attachment`)
- [x] Compose/reply UX for Gmail (toggle for new vs reply mode, To/Cc/Subject inputs)
- [x] Compose UX for WhatsApp (Enter-to-send)
- [x] Live event subscriptions for sync.started/completed/failed and WhatsApp QR/connection/message events

### Phase 3 completed
- [x] Cluster persistence schema (`clusters`, `cluster_members`, `ai_outputs`)
- [x] Cluster CRUD IPC + multi-select with Cmd-click + Shift-click range
- [x] Cluster grouping view in sidebar (Clusters tab)
- [x] Ollama workflow extractor (`@workspace/ai`) with the original prototype prompt
- [x] AI panel: cluster picker + lookback hours pickers + run-for-cluster + run-for-all + collated output rendering
- [x] Cheat code (`wipeclusters` to clear all, Cmd/Ctrl+E for cheat list)
- [x] Coming-soon channels banner (Slack / Teams / Discord / Telegram placeholder)
- [x] First-run onboarding modal (Get-started flow flips `onboardingCompleted`)
- [x] Settings modal: theme cycle, Ollama base URL + model overrides, connector status, storage paths, app version
- [x] Cluster rename / recolor / delete via right-click context menu in the Clusters tab

### Phase 4 completed
- [x] Diagnostics export IPC (`workspace:diagnostics:export`) producing a sanitized JSON bundle (app + paths + migrations + connector states + log tail + backup files)
- [x] Update checker (`createUpdateChecker` in `@workspace/core`) with version compare, optional vs required modes, configurable feed URL via `WORKSPACE_UPDATE_FEED_URL`
- [x] `electron-updater` wired (download progress + apply, gated to production mode); IPCs `workspace:update:download` / `workspace:update:install`; events forwarded as `workspace:update:event`
- [x] Required-update enforcement screen (full-window, blocks workspace until upgraded)
- [x] Optional-update banner in the sidebar with download progress + install
- [x] electron-builder release config (mac dmg + zip with hardened runtime + entitlements file at `apps/desktop/build/entitlements.mac.plist`, win nsis, linux AppImage); `pnpm release:desktop` toggles between unsigned-dir (default) and signed-release modes via `WORKSPACE_RELEASE=1` and `CSC_*` / `APPLE_*` env vars
- [x] Migration testing harness (`scripts/test-migrations.js`) — fresh bootstrap, idempotency, v1-baseline upgrade with row preservation; runs via `pnpm test:migrations`
- [x] Friends/family QA plan in `docs/QA_PLAN.md`
- [x] Release + update guide in `docs/RELEASE.md`
- [ ] Sign with real Apple/Microsoft developer credentials (operational, not code)
- [ ] Host the actual update feed (operational, not code)
- [ ] Run a real end-to-end QA pass against installed beta build

## Phase status

## Phase 0 — repo setup
Status: complete

## Phase 1 — desktop MVP foundation
Status: complete

## Phase 2 — connectors
Status: complete

## Phase 3 — core product UX
Status: complete (clusters, AI panel, onboarding, settings, cluster context menu all shipped)

## Phase 4 — release readiness
Status: code complete (diagnostics, updater download/install, required + optional update UX, electron-builder release config, migration test harness, QA plan and release guide all in place). Operational steps — actual signing identities, hosting the update feed, and running QA on real installs — are next.

## Current problems / risks

### 1. WhatsApp product risk
- Personal WhatsApp support depends on Baileys / WhatsApp Web behavior.
- Reliability and account/session stability may vary.

### 2. AI output reliance on local Ollama
- Workflow extraction calls `OLLAMA_BASE_URL` (default `127.0.0.1:11434`) with `OLLAMA_MODEL` (default `llama3:8b`). Requires Ollama running locally; otherwise the AI panel surfaces an error.

### 3. Update/migration complexity
- Updater and forced-update flow still need to be designed end-to-end before beta distribution.

## Immediate next steps

1. Stand up the staging update feed (host `latest-mac.yml` + `latest.yml` + the JSON metadata feed used by `createUpdateChecker`) and run section 6 of `docs/QA_PLAN.md` end-to-end.
2. Provision Apple / Microsoft signing credentials and run `WORKSPACE_RELEASE=1 pnpm release:desktop` to produce the first signed beta build.
3. Run the full friends/family QA pass against the signed build; track regressions in `docs/QA_PLAN.md` section 9.
