# Chai

Desktop-first, local-first communications workspace for freelancers.

The living project references are:
- `docs/PLAN.md`
- `docs/PROGRESS.md`
- `docs/QA_PLAN.md`
- `docs/RELEASE.md`

## Current status

Phases 1-4 are **code complete** for v1. The desktop app version is owned by `apps/desktop/package.json`; the latest checked-in release candidate is `v0.1.12`.

The v0.1.12 local Mac build has passed bridge lifecycle and required/optional update smoke checks. Account pairing, Windows installed UI QA, and signing remain operational acceptance steps; see `docs/PROGRESS.md`.

The renderer is a 3-pane workspace: sidebar with WhatsApp / Email / Clusters tabs, thread + composer, and AI insights panel. The shell wraps it with first-run onboarding, a settings modal, migration recovery, optional-update banner, and required-update enforcement screen.

## Monorepo layout

```text
apps/desktop                       Electron lifecycle, IPC, build/dev/package helpers
packages/ui                        React + Vite renderer
packages/core                      runtime composition (logger, settings, runtime, connector orchestrator)
packages/db                        SQLite bootstrap, migrations, typed repositories
packages/agent-bridge              local MCP/RPC bridge for trusted laptop agents
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
pnpm release:desktop    # unsigned installers; optional CSC_*/APPLE_* signing env
pnpm verify:data-paths  # smoke-tests dev/prod data paths + migrations
pnpm test:migrations    # runs the migration test harness (fresh + idempotent + v1-upgrade)
pnpm typecheck          # typecheck all packages
```

See `docs/RELEASE.md` for signing + publish details, and `docs/QA_PLAN.md` for the friends/family beta checklist.

`pnpm dev` triggers a one-shot build of `@chai/{shared,db,core,agent-bridge,connectors-gmail,connectors-whatsapp}` and `chai` so the Electron main process can resolve them at runtime.

## Local agent bridge

Chai starts a trusted local agent bridge with the desktop runtime. It binds to `127.0.0.1:43124` by default and exposes:
- MCP over HTTP at `/mcp`
- JSON RPC at `/rpc`

The bearer token is written to `<data>/agent-bridge.json` and is visible as a token-file path in Settings. Override with `CHAI_AGENT_BRIDGE_HOST`, `CHAI_AGENT_BRIDGE_PORT`, `CHAI_AGENT_BRIDGE_TOKEN`, or disable with `CHAI_AGENT_BRIDGE_DISABLED=1`.

For investment-run notifications to the WhatsApp Notes group, see
[`docs/INVESTMENT_NOTIFICATIONS.md`](docs/INVESTMENT_NOTIFICATIONS.md). The
`scripts/chai-notify.py` helper resolves and pins the group, then checks the
nested send result. The bridge is included starting with `v0.1.12`. See
[`docs/AGENT_BRIDGE.md`](docs/AGENT_BRIDGE.md) for authentication and tool usage.

## Reset commands (macOS)

```bash
pnpm app:rebuild            # rebuild the .app, DB preserved
pnpm app:rebuild-fresh      # wipe ALL app data (DB, settings, OAuth tokens, logs), then rebuild
pnpm clear:app              # wipe ALL Chai app files, including /Applications/Chai.app, ~/Library/Application Support/Chai, and .dev-data
pnpm db:wipe                # wipe just the SQLite database; OAuth tokens + settings stay
```

Quit the app before running `app:rebuild-fresh`, `clear:app`, or `db:wipe` — Electron has the SQLite WAL open while running, and a live instance will write its in-memory state back over your reset.

These scripts target the macOS app bundle path (`/Applications/Chai.app`) and userData path (`~/Library/Application Support/Chai/`). On Windows/Linux the paths are different; use `pnpm verify:data-paths` to print the exact location for your platform.

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
