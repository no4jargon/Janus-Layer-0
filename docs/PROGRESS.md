# Productization Progress Tracker

Status: active
Last updated: 2026-07-02
Scope tracked here: desktop-first, local-first freelancer communications workspace.

## Overall status

Current phase: **Phase 1-4 complete in code**, with one deliberate scope shift in distribution: builds ship **unsigned** via **GitHub Releases**, with a per-release `latest.json` driving a full-window forced-update screen on every prior version by default. Users click through to the GitHub release page in their browser to download and install the new installer. Auto-download / quit-and-install via `electron-updater` is intentionally not used because unsigned macOS binaries cannot self-replace; the wiring is left in place behind feature flags so it can be re-enabled if/when builds are signed.

The latest checked-in release candidate is `v0.1.11` (`apps/desktop/package.json`). Local `pnpm typecheck` and `pnpm test:migrations` were green on 2026-07-02. Outstanding work is QA against installed builds and a real forced-update dry run.

Overall summary:
- **Phase 0 is complete.**
- **Phase 1 is complete** — runtime, DB, logger, settings, migration recovery all live behind package boundaries.
- **Phase 2 is complete** — Gmail connector + send outbox, WhatsApp Baileys connector + send outbox, attachment download UX, compose/reply UX in the renderer, live event subscriptions for sync + WhatsApp messages.
- **Phase 3 is complete** — cluster CRUD + multi-select UX + AI workflow extraction panel ported from the demo, persisted in DB; settings + onboarding modals; cluster rename/recolor right-click menu.
- **Phase 4 is complete in code** for the unsigned distribution model — diagnostics export, version-compare update checker, `latest.json` generation + upload, full-window forced-update screen, optional sidebar banner (both link to GitHub Releases for manual install), `pnpm release:desktop` builds + publishes installers and `latest.json` to a draft release.

The renderer is a 3-pane workspace: sidebar with WhatsApp / Email / Clusters tabs + More-channels menu, thread + composer, and AI panel with cluster + lookback hours pickers.

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
- [x] Created new repository scaffold (`chai`)
- [x] Initialized git repository
- [x] Created monorepo structure (`apps/`, `packages/`, `docs/`, `scripts/`)
- [x] Added workspace configuration (`pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`)
- [x] Added package-level scaffolds for desktop, UI, core, DB, connectors, AI, and shared
- [x] Replaced placeholder runners with real Electron + React/Vite wiring
- [x] Added desktop packaging command (`pnpm package:desktop`)
- [x] Added dev/prod data path conventions in code and smoke verification
- [x] Established package boundaries for desktop, UI, core, DB, connectors, AI, prompts, and shared types

### Phase 1 completed
- [x] Runtime bootstrap orchestration extracted into `@chai/core`
- [x] DB bootstrap + migration runner extracted into `@chai/db`
- [x] Pre-migration database backups (timestamped copies under `<data>/backups/`)
- [x] Migration failure surfaced via runtime snapshot; UI shows retry screen and a retry IPC restarts the runtime
- [x] File-based structured logging (`<data>/logs/app.log`)
- [x] Settings store (`<data>/settings.json`) with runtime read/write IPC
- [x] Hardened Electron baseline (sandbox, single-instance lock, delayed show)
- [x] Workspace `.env` loading in desktop runtime

### Phase 2 completed
- [x] `@chai/db` typed repos: `createEmailStore`, `createWhatsAppStore`, `createConnectorStateStore`, `createClusterStore`, `createAiOutputStore`
- [x] Gmail OAuth desktop flow + token refresh + profile fetch + thread/message mirror sync (`@chai/connectors-gmail`)
- [x] Gmail send outbox pipeline (`createGmailSendService`) wired through IPC
- [x] WhatsApp connector on top of `baileys` (multi-file auth state, QR streaming, reconnect with backoff, mirror events)
- [x] WhatsApp send outbox pipeline (`createWhatsAppSendService`)
- [x] DB migrations: `001_init`, `002_email_mirror`, `003_whatsapp_mirror`, `004_wa_outbox`, `005_clusters_and_ai`, `006_wa_reply_context`
- [x] Attachment download UX (Electron save dialog, IPC at `chai:gmail:download-attachment`)
- [x] Compose/reply UX for Gmail (toggle for new vs reply mode, To/Cc/Subject inputs)
- [x] Compose UX for WhatsApp (Enter-to-send)
- [x] Live event subscriptions for sync.started/completed/failed and WhatsApp QR/connection/message events

### Phase 3 completed
- [x] Cluster persistence schema (`clusters`, `cluster_members`, `ai_outputs`)
- [x] Cluster CRUD IPC + multi-select with Cmd-click + Shift-click range
- [x] Cluster grouping view in sidebar (Clusters tab)
- [x] Workflow extractor runtime (`@chai/ai`) and prompt package (`@chai/ai-prompts`)
- [x] AI panel: cluster picker + lookback hours pickers + run-for-cluster + run-for-all + collated output rendering
- [x] Cheat code (`wipeclusters` to clear all, Cmd/Ctrl+E for cheat list)
- [x] Coming-soon channels banner (Slack / Teams / Discord / Telegram placeholder)
- [x] First-run onboarding modal (Get-started flow flips `onboardingCompleted`)
- [x] Settings modal: theme cycle, Ollama base URL + model overrides, connector status, storage paths, app version
- [x] Cluster rename / recolor / delete via right-click context menu in the Clusters tab

### Phase 4 completed
- [x] Diagnostics export IPC (`chai:diagnostics:export`) producing a sanitized JSON bundle (app + paths + migrations + connector states + log tail + backup files)
- [x] Update checker (`createUpdateChecker` in `@chai/core`) with version compare, optional vs required modes; defaults to the GitHub Releases `latest.json` for this repo, overridable via `CHAI_UPDATE_FEED_URL`
- [x] **Distribution model: unsigned builds via GitHub Releases.** Required + optional update UI both link to the GitHub release page in the system browser; users manually download the new installer and install it over the running app. No in-app auto-download / quit-and-install (unsigned macOS binaries can't self-replace via Gatekeeper). The `electron-updater` wiring + IPCs (`chai:update:download` / `chai:update:install`) are kept in place behind feature flags so they can be re-enabled if/when builds are signed.
- [x] Required-update enforcement screen — full-window, blocks workspace, **default behavior on every release** (forces every prior version to update). Opt out per release with `MIN_SUPPORTED_VERSION` set below the new version when a release should not block existing users.
- [x] Optional-update banner in the sidebar (only fires when `MIN_SUPPORTED_VERSION` is opted out below `latestVersion`); links to GitHub release page; dismissable.
- [x] electron-builder release config (mac dmg + zip, win nsis, linux AppImage) with `provider: github` for `no4jargon/Janus-Layer-0`. `pnpm release:desktop` toggles between unsigned-dir (default) and unsigned-release-publish modes via `CHAI_RELEASE=1`. `CSC_*` / `APPLE_*` signing env vars are still wired so signing can be turned on later without code changes.
- [x] Update artifact hosting: GitHub Releases. `apps/desktop/electron/package.js` writes `dist/latest.json` per release (with `MIN_SUPPORTED_VERSION` defaulting to the new version → forces every prior build) and uploads it via `gh release upload` when `CHAI_PUBLISH=1`.
- [x] Release pipeline has produced tagged beta candidates through `v0.1.11`; current candidate uses `apps/desktop/package.json` version `0.1.11`.
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
- Forced-update flow still needs to be exercised against a real installed older build and the current release feed.
- The release script's `gh release upload` step assumes `gh` CLI + a `GH_TOKEN` with `contents: write`; if that step is silently skipped, the JSON feed gets stale and forced updates won't trigger. Verify after the first publish.

## Immediate next steps

1. Verify the GitHub release for `v0.1.11`: draft/published state, macOS + Windows assets, `latest.json`, and intended `minSupportedVersion`.
2. Install `v0.1.11` on at least one Mac and one Windows machine; run the full friends/family QA pass (`docs/QA_PLAN.md` sections 1-7).
3. Forced-update dry run: install a known older build, stage or publish an N+1 feed with `minSupportedVersion` above the installed version, and confirm launch lands directly on **Update required**.
4. Optional-update dry run: stage or publish a feed where `latestVersion` is newer but `minSupportedVersion` still allows the installed version; confirm the sidebar banner path.
5. After QA is green, provision Apple / Microsoft signing credentials and re-bind the renderer's update buttons to the in-app `electron-updater` flow that's still wired but unused.
