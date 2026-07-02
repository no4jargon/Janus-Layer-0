# Chai

Desktop-first, local-first communications workspace for freelancers.

The living project references are:
- `docs/PLAN.md`
- `docs/PROGRESS.md`
- `docs/QA_PLAN.md`
- `docs/RELEASE.md`

## Current status

Phases 1-4 are **code complete** for v1. The desktop app version is owned by `apps/desktop/package.json`; the latest checked-in release candidate is `v0.1.11`.

Outstanding work is operational: verify the current GitHub release feed, run the QA pass in `docs/QA_PLAN.md` against real installs, exercise forced/optional update behavior, and then provision Apple / Microsoft signing identities.

The renderer is a 3-pane workspace: sidebar with WhatsApp / Email / Clusters tabs, thread + composer, and AI insights panel. The shell wraps it with first-run onboarding, a settings modal, migration recovery, optional-update banner, and required-update enforcement screen.

## Monorepo layout

```text
apps/desktop                       Electron lifecycle, IPC, build/dev/package helpers
packages/ui                        React + Vite renderer
packages/core                      runtime composition (logger, settings, runtime, connector orchestrator)
packages/db                        SQLite bootstrap, migrations, typed repositories
packages/connectors-gmail          Gmail OAuth, mirror sync, send service
packages/connectors-whatsapp       Baileys-backed WhatsApp connector + send service
packages/ai                        local model runtime
packages/ai-prompts                workflow extraction prompts + snapshots
packages/shared                    cross-package types
```

## Development commands

```bash
pnpm install            # install workspace deps
pnpm build              # builds all packages (TS -> dist) and the renderer
pnpm dev                # starts Electron + Vite (auto-builds packages first)
pnpm dev:ui             # renderer-only loop
pnpm package:desktop    # produces an unsigned dir Electron build under apps/desktop/dist
pnpm release:desktop    # signed installer build (needs CHAI_RELEASE=1, CSC_*/APPLE_* env)
pnpm verify:data-paths  # smoke-tests dev/prod data paths + migrations
pnpm test:migrations    # runs the migration test harness (fresh + idempotent + v1-upgrade)
pnpm typecheck          # typecheck all packages
```

See `docs/RELEASE.md` for signing + publish details, and `docs/QA_PLAN.md` for the friends/family beta checklist.

`pnpm dev` triggers a one-shot build of `@chai/{shared,db,core,connectors-gmail,connectors-whatsapp}` and `chai` so the Electron main process can resolve them at runtime.

## Reset commands (macOS)

```bash
pnpm app:rebuild            # rebuild the .app, DB preserved
pnpm app:rebuild-fresh      # wipe ALL app data (DB, settings, OAuth tokens, logs), then rebuild
pnpm clear:app              # wipe ALL Chai app data, including ~/Library/Application Support/Chai and .dev-data
pnpm db:wipe                # wipe just the SQLite database; OAuth tokens + settings stay
```

Quit the app before running `app:rebuild-fresh`, `clear:app`, or `db:wipe` — Electron has the SQLite WAL open while running, and a live instance will write its in-memory state back over your reset.

These scripts target the macOS userData path (`~/Library/Application Support/Chai/`). On Windows/Linux the paths are different; use `pnpm verify:data-paths` to print the exact location for your platform.

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
