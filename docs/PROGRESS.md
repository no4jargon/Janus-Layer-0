# Productization Progress Tracker

Status: active
Last updated: 2026-05-03
Scope tracked here: desktop-first, local-first freelancer communications workspace derived from the original `Baileys/demo` prototype.

## Overall status

Current phase: **Phase 1–4 complete in code**, with one deliberate scope shift in distribution: builds ship **unsigned** via **GitHub Releases**, with a per-release `latest.json` driving a full-window forced-update screen on every prior version by default. Users click through to the GitHub release page in their browser to download and install the new installer. Auto-download / quit-and-install via `electron-updater` is intentionally not used because unsigned macOS binaries cannot self-replace; the wiring is left in place behind feature flags so it can be re-enabled if/when builds are signed.

The first draft release (`v0.1.0`, 10 assets including `latest.json`) has been verified end-to-end. Outstanding work is QA against installed builds and the first non-zero version bump that actually exercises the forced-update path.

Overall summary:
- **Phase 0 is complete.**
- **Phase 1 is complete** — runtime, DB, logger, settings, migration recovery all live behind package boundaries.
- **Phase 2 is complete** — Gmail connector + send outbox, WhatsApp Baileys connector + send outbox, attachment download UX, compose/reply UX in the renderer, live event subscriptions for sync + WhatsApp messages.
- **Phase 3 is complete** — cluster CRUD + multi-select UX + AI workflow extraction panel ported from the demo, persisted in DB; settings + onboarding modals; cluster rename/recolor right-click menu.
- **Phase 4 is complete in code** for the unsigned distribution model — diagnostics export, version-compare update checker, `latest.json` generation + upload, full-window forced-update screen, optional sidebar banner (both link to GitHub Releases for manual install), `pnpm release:desktop` builds + publishes installers and `latest.json` to a draft release.

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
- [x] Update checker (`createUpdateChecker` in `@workspace/core`) with version compare, optional vs required modes; defaults to the GitHub Releases `latest.json` for this repo, overridable via `WORKSPACE_UPDATE_FEED_URL`
- [x] **Distribution model: unsigned builds via GitHub Releases.** Required + optional update UI both link to the GitHub release page in the system browser; users manually download the new installer and install it over the running app. No in-app auto-download / quit-and-install (unsigned macOS binaries can't self-replace via Gatekeeper). The `electron-updater` wiring + IPCs (`workspace:update:download` / `workspace:update:install`) are kept in place behind feature flags so they can be re-enabled if/when builds are signed.
- [x] Required-update enforcement screen — full-window, blocks workspace, **default behavior on every release** (forces every prior version to update). Opt out per release with `MIN_SUPPORTED_VERSION` set below the new version when a release should not block existing users.
- [x] Optional-update banner in the sidebar (only fires when `MIN_SUPPORTED_VERSION` is opted out below `latestVersion`); links to GitHub release page; dismissable.
- [x] electron-builder release config (mac dmg + zip, win nsis, linux AppImage) with `provider: github` for `no4jargon/Janus-Layer-0`. `pnpm release:desktop` toggles between unsigned-dir (default) and unsigned-release-publish modes via `WORKSPACE_RELEASE=1`. `CSC_*` / `APPLE_*` signing env vars are still wired so signing can be turned on later without code changes.
- [x] Update artifact hosting: GitHub Releases. `apps/desktop/electron/package.js` writes `dist/latest.json` per release (with `MIN_SUPPORTED_VERSION` defaulting to the new version → forces every prior build) and uploads it via `gh release upload` when `WORKSPACE_PUBLISH=1`.
- [x] First draft release (`v0.1.0`) verified end-to-end on GitHub: `latest.json` + `latest-mac.yml` + 4 installers (arm64 + x64 dmg/zip) + 4 blockmaps uploaded as a draft.
- [x] Migration testing harness (`scripts/test-migrations.js`) — fresh bootstrap, idempotency, v1-baseline upgrade with row preservation; runs via `pnpm test:migrations`
- [x] CI workflow: `.github/workflows/ci.yml` runs install + build + typecheck + migrations test + verify on every PR
- [x] Release workflow: `.github/workflows/release.yml` triggers on `v*` tag push (or manual dispatch); builds + publishes draft release + `latest.json` using the repo's `GITHUB_TOKEN` (no PAT needed)
- [x] Friends/family QA plan in `docs/QA_PLAN.md` (section 6 reflects the unsigned + manual-download flow)
- [x] Release + update guide in `docs/RELEASE.md`
- [ ] Run a real end-to-end QA pass against an installed beta build, including a forced-update dry run: ship release N+1 with `MIN_SUPPORTED_VERSION` ≥ N, install N, confirm N is blocked on launch

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
Status: code complete (diagnostics, updater download/install, required + optional update UX, electron-builder release config, GitHub Releases publish + per-release `latest.json` generation, migration test harness, QA plan and release guide all in place). Operational steps — actual signing identities and running QA (including a forced-update dry run) on real installs — are next.

## Current problems / risks

### 1. WhatsApp product risk
- Personal WhatsApp support depends on Baileys / WhatsApp Web behavior.
- Reliability and account/session stability may vary.

### 2. AI output reliance on local Ollama
- Workflow extraction calls `OLLAMA_BASE_URL` (default `127.0.0.1:11434`) with `OLLAMA_MODEL` (default `llama3:8b`). Requires Ollama running locally; otherwise the AI panel surfaces an error.

### 3. Update/migration complexity
- Forced-update flow has not yet been exercised against a real install — the first GitHub release with `MIN_SUPPORTED_VERSION` set should be treated as a load-bearing test.
- The release script's `gh release upload` step assumes `gh` CLI + a `GH_TOKEN` with `contents: write`; if that step is silently skipped, the JSON feed gets stale and forced updates won't trigger. Verify after the first publish.

## Immediate next steps

1. Promote the verified `v0.1.0` draft to a published release; install it on at least one Mac and one Windows machine; record `<data>/logs/app.log` location + diagnostics export shape per `docs/QA_PLAN.md` section 8.
2. Cut a `v0.1.1` test release with `MIN_SUPPORTED_VERSION=0.1.1` set; confirm the installed `v0.1.0` lands directly on the **Update required** screen on next launch and stays there until the new installer is run.
3. Cut a `v0.1.2` opt-out release with `MIN_SUPPORTED_VERSION=0.1.0` set; confirm the installed `v0.1.0` shows the optional sidebar banner instead of the blocking screen.
4. Run the full friends/family QA pass (`docs/QA_PLAN.md` sections 1–7) and update section 9's regression watchlist.
5. (Later) provision Apple / Microsoft signing credentials and re-bind the renderer's update buttons to the in-app `electron-updater` flow that's still wired but unused.
