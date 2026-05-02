# Prototype Migration Map

This file tracks source-material copied from `Baileys/demo` into `workspace-app`, plus where the production implementation now lives in package boundaries.

## Reference copies (read-only)

These files were copied verbatim from the prototype and remain in the package source trees as historical references. They are excluded from `tsc` builds via per-package `exclude: ["src/prototype-*.ts"]`.

| Prototype source | Reference copy in workspace-app |
|---|---|
| `demo/db.ts` | `packages/db/src/prototype-db.ts` |
| `demo/email.ts` | `packages/connectors-gmail/src/prototype-email.ts` |
| `demo/email-send.ts` | `packages/connectors-gmail/src/prototype-email-send.ts` |
| `demo/whatsapp-send.ts` | `packages/connectors-whatsapp/src/prototype-whatsapp-send.ts` |
| `demo/server.ts` | `packages/core/src/prototype-server.ts` |
| `demo/llm/extract_workflow.py` | `packages/ai/src/prototype-extract_workflow.py` |

## Production implementations (active code)

| Concern | Lives in |
|---|---|
| DB bootstrap + migration runner with backup-on-fail | `packages/db/src/bootstrap.ts` |
| Email mirror schema + repos | `packages/db/migrations/002_email_mirror.sql`, `packages/db/src/email-store.ts` |
| WhatsApp mirror schema + repos | `packages/db/migrations/003_whatsapp_mirror.sql`, `packages/db/src/whatsapp-store.ts` |
| WhatsApp send outbox schema | `packages/db/migrations/004_wa_outbox.sql` |
| Email send outbox schema | included in `packages/db/migrations/002_email_mirror.sql` |
| Connector state schema | `packages/db/migrations/001_init.sql` |
| Logger / settings store / runtime composition | `packages/core/src/{logger,settings-store,runtime}.ts` |
| Connector orchestration (status lifecycle, persistence, snapshots) | `packages/core/src/connector-runtime.ts` |
| Gmail OAuth desktop flow + token refresh | `packages/connectors-gmail/src/oauth.ts` |
| Gmail thread/message mirror sync | `packages/connectors-gmail/src/gmail-connector.ts` |
| Gmail send pipeline (outbox dedupe + RFC reply headers + send) | `packages/connectors-gmail/src/gmail-send-service.ts` |
| Baileys-backed WhatsApp connector (QR, reconnect, mirror events) | `packages/connectors-whatsapp/src/whatsapp-connector.ts` |
| WhatsApp send pipeline | `packages/connectors-whatsapp/src/whatsapp-send-service.ts` |
| Electron lifecycle, IPC, env loading | `apps/desktop/electron/{main,preload,env,dev,build,package,verify-data-paths,stage-migrations}.js` |
| Renderer (React) | `packages/ui/src/{App,main,styles,global.d}.tsx` |

## Extraction policy

- `prototype-*` files stay as read-only baseline references.
- Production code lives behind package boundaries with typed APIs.
- Electron-side code is now thin glue: window lifecycle, IPC bridging, build/dev helpers. All runtime logic lives in `packages/`.

## Phase 3 ports (current)

- Renderer 3-pane UX — `packages/ui/src/{App,Workspace,AiPanel}.tsx` (ported from `demo/public/app.js`)
- Renderer styles — `packages/ui/src/styles.css` (ported from `demo/public/style.css`)
- Cluster persistence — `packages/db/migrations/005_clusters_and_ai.sql`, `packages/db/src/cluster-store.ts`
- AI workflow extraction (Ollama) — `packages/ai/src/{ollama,workflow-prompt}.ts`
- Compose / reply UX (Gmail + WhatsApp) — `packages/ui/src/Workspace.tsx`
- Attachment download UX — IPC `workspace:gmail:download-attachment` + Electron save dialog in `apps/desktop/electron/main.js`

## Phase 3 polish (current)

- Settings + onboarding modal — `packages/ui/src/Settings.tsx`
- Cluster rename / recolor / delete via right-click context menu — `packages/ui/src/Workspace.tsx`
- WorkspaceSettings extended with `ollamaBaseUrl` / `ollamaModel` overrides; main rebuilds the workflow extractor on settings change.

## Phase 4 (current)

- Diagnostics bundle builder — `packages/core/src/diagnostics.ts`
- Update checker (version compare + optional/required logic) — `packages/core/src/updater.ts`
- `electron-updater` integration with download progress, quit-and-install, and event forwarding to the renderer — `apps/desktop/electron/main.js` (`configureAutoUpdater`, `runUpdateCheck`)
- Required-update full-window screen + optional-update sidebar banner — `packages/ui/src/UpdateScreens.tsx`
- electron-builder release config (mac dmg + zip, hardened runtime + entitlements; win nsis; linux AppImage); `pnpm release:desktop` toggles via `WORKSPACE_RELEASE=1` — `apps/desktop/package.json`, `apps/desktop/build/entitlements.mac.plist`, `apps/desktop/electron/package.js`
- Migration test harness — `scripts/test-migrations.js`, `scripts/fixtures/migrations-v1/`
- Release + update guide — `docs/RELEASE.md`
- Friends/family QA plan — `docs/QA_PLAN.md`

## Not yet ported

- Actual signing identities and hosted update feed (operational, not code).
- Stable channel discipline (currently beta-only).
- Mobile companion / encrypted sync — explicitly later in `docs/PLAN.md`.
