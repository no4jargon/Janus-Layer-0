# Workspace App

Desktop-first, local-first communications workspace for freelancers.

This repository is bootstrapped from the `Baileys/demo` prototype, following:
- `docs/PLAN.md`
- `docs/PROGRESS.md`
- `docs/REPO_BOOTSTRAP.md`
- `docs/PROTOTYPE_MIGRATION_MAP.md`
- `docs/DEMO_IMPORT_AUDIT.md`

## Current status

Phases 1–4 are **code complete** for v1. Outstanding work is operational: provisioning Apple / Microsoft signing identities, hosting the update feed, and running the QA pass in `docs/QA_PLAN.md` against real installs.

Renderer mirrors the demo prototype's UX 1:1 — 3-pane layout (Sidebar with WhatsApp / Email / Clusters tabs, Thread + composer, AI insights panel) with cluster state moved from `localStorage` to the DB. The shell wraps it with first-run onboarding, a settings modal, migration recovery, optional-update banner, and required-update enforcement screen.

## Monorepo layout

```text
apps/desktop                       Electron lifecycle, IPC, build/dev/package helpers
packages/ui                        React + Vite renderer
packages/core                      runtime composition (logger, settings, runtime, connector orchestrator)
packages/db                        SQLite bootstrap, migrations, typed repositories
packages/connectors-gmail          Gmail OAuth, mirror sync, send service
packages/connectors-whatsapp       Baileys-backed WhatsApp connector + send service
packages/ai                        prompt scaffolding (Phase 3)
packages/shared                    cross-package types
```

## Development commands

```bash
pnpm install            # install workspace deps
pnpm build              # builds all packages (TS -> dist) and the renderer
pnpm dev                # starts Electron + Vite (auto-builds packages first)
pnpm dev:ui             # renderer-only loop
pnpm package:desktop    # produces an unsigned dir Electron build under apps/desktop/dist
pnpm release:desktop    # signed installer build (needs WORKSPACE_RELEASE=1, CSC_*/APPLE_* env)
pnpm verify:data-paths  # smoke-tests dev/prod data paths + migrations
pnpm test:migrations    # runs the migration test harness (fresh + idempotent + v1-upgrade)
pnpm typecheck          # typecheck all packages
```

See `docs/RELEASE.md` for signing + publish details, and `docs/QA_PLAN.md` for the friends/family beta checklist.

`pnpm dev` triggers a one-shot build of `@workspace/{shared,db,core,connectors-gmail,connectors-whatsapp}` so the Electron main process can resolve them at runtime.

## Runtime data conventions

- Development data root: `<repo>/.dev-data/`
- Production data root: `<os-user-data>/data/`
- Pre-migration backups: `<data>/backups/app-pre-migration-<timestamp>.db`

## Connector environment

Copy `.env.example` to `.env` (loaded by the desktop runtime) and configure:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` (default desktop callback: `http://127.0.0.1:43123/oauth/google/callback`)

WhatsApp pairing is QR-driven inside the desktop window and does not require env configuration.

## Prototype reference material

`prototype-*.ts` files inside the package source trees are read-only copies of the original prototype. They stay around as a baseline; production code lives next to them in non-`prototype-*` files.
