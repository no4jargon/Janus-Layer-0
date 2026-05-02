# New Repository Bootstrap Guide

Status: planning document
Purpose: define how to bootstrap the new standalone product repository from the current `demo/` prototype.

## 1. Goal

Create a new repository for a **desktop-first, local-first communications workspace** that reuses the best parts of the current `demo/` while leaving prototype-specific code behind.

This file is the practical companion to:
- `demo/PLAN.md` — product/architecture direction
- `demo/PROGRESS.md` — current phase and blockers

## 2. Recommended stack

- **Electron** for desktop shell
- **React + Vite** for UI
- **Node + TypeScript** for local services
- **SQLite** for local persistence
- **pnpm workspaces** for the monorepo
- **electron-builder** or equivalent for packaging
- **Ollama** for local AI support

## 3. Recommended repository layout

```text
janus-layer-0/
  apps/
    desktop/
      src/
      electron/
      package.json
  packages/
    ui/
      src/
    core/
      src/
    db/
      src/
      migrations/
    connectors-gmail/
      src/
    connectors-whatsapp/
      src/
    ai/
      src/
    shared/
      src/
  docs/
  scripts/
  .gitignore
  .env.example
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  README.md
```

## 4. Responsibilities by package

### `apps/desktop`
- Electron main process
- preload / IPC bridge
- app lifecycle
- window creation
- packaging config
- updater integration later

### `packages/ui`
- React app
- inbox/thread/cluster/settings screens
- user interaction flows
- connection state display
- onboarding screens

### `packages/core`
- app orchestration
- sync coordination
- command handlers
- service container / app startup logic
- domain rules not tied to UI

### `packages/db`
- SQLite connection setup
- schema management
- migrations
- repositories / query layer
- backup helpers

### `packages/connectors-gmail`
- Gmail OAuth
- token refresh
- thread/message sync
- send/reply support if retained

### `packages/connectors-whatsapp`
- Baileys integration
- QR/pairing flow
- reconnect/reset logic
- chat/message mirroring

### `packages/ai`
- Ollama adapter
- prompt templates
- extraction/summarization logic
- structured AI output schemas

### `packages/shared`
- shared types
- validation schemas
- constants
- event payload shapes

## 5. Recommended development modes

## Mode A — UI only
Use for fast UX iteration.

Runs:
- React app only
- mocked or fixture-backed data

Use when working on:
- layout
- selection UX
- cluster UI
- settings screens
- onboarding

## Mode B — full desktop dev
Use for real integration work.

Runs:
- Electron shell
- local backend/services
- real SQLite DB
- real connector code when needed

Use when working on:
- Gmail OAuth
- WhatsApp sessions
- DB migrations
- attachment handling
- AI execution paths

## Mode C — packaged smoke test
Use before every shared build.

Runs:
- packaged app
- clean/fresh data directory
- upgrade path testing

Use when working on:
- installers
- migrations
- updater
- production-only path issues

## 6. Local machine workflow

## Daily fast loop
Primary commands should become:

```bash
pnpm install
pnpm dev:ui
pnpm dev
pnpm build
```

### `pnpm dev:ui`
- fastest frontend loop
- no need to boot full desktop app

### `pnpm dev`
- launches full desktop app in dev mode
- uses a dev data directory like `./.dev-data/`
- writes verbose logs

### `pnpm build`
- builds packaged desktop app
- used before sharing builds

## 7. Dev/prod separation

### Development
Use a local repository data folder such as:

```text
./.dev-data/
```

Suggested contents:
- `app.db`
- `attachments/`
- `logs/`
- `gmail-token.json` or equivalent dev token store
- `whatsapp-session/`

### Production
Use OS app-data directories.

Examples:
- macOS: `~/Library/Application Support/<AppName>/`
- Windows: `%AppData%\\<AppName>\\`

Suggested contents:
- `app.db`
- `attachments/`
- `logs/`
- secure token/session references

## 8. Week 1 bootstrap plan

### Day 1 — create repository skeleton
- create new git repo
- initialize `pnpm` workspace
- add root `package.json`
- add `apps/desktop`
- add `packages/ui`
- add `packages/shared`
- set up root TypeScript config

### Day 2 — boot Electron + React
- wire Electron to open the React app
- support dev mode URL and prod bundled files
- confirm desktop window launches in both modes

### Day 3 — add DB package
- create SQLite bootstrap module
- add schema version table
- add first migration runner
- add dev/prod data-path resolver

### Day 4 — move shared prototype logic
- move reusable DB/domain code from `demo/`
- move message/thread types into `packages/shared`
- avoid copying prototype-only glue blindly

### Day 5 — choose connector extraction order
Recommended order:
1. Gmail connector first
2. WhatsApp connector second

Reason:
- Gmail is usually easier to stabilize
- WhatsApp has more product and reliability risk

### Day 6 — observability and settings
- add logging system
- add settings persistence
- add diagnostics metadata
- create a basic settings screen stub

### Day 7 — first packaged smoke test
- build packaged app
- launch fresh install
- confirm DB creation, logs, and app startup

## 9. What to move first from the current prototype

Move early:
- data model ideas
- SQLite persistence logic
- Gmail sync concepts
- WhatsApp mirror concepts
- AI action concepts
- reusable UI behaviors

Move later/refactor carefully:
- prototype-specific server bootstrapping
- browser-local cluster persistence
- hidden cheat-code UX
- hardcoded paths or assumptions
- prototype-only env loading patterns

## 10. Suggested first milestones in the new repo

### Milestone 1
- desktop shell opens
- React app renders
- DB initializes
- logs work

### Milestone 2
- Gmail connect/sync works
- data persists after restart
- thread list renders in desktop shell

### Milestone 3
- WhatsApp connect/sync works
- reconnect/reset works
- both sources appear in one workspace

### Milestone 4
- cluster model moves into DB
- AI panel becomes first-class UI
- onboarding/settings become usable

### Milestone 5
- packaged builds
- migrations
- diagnostics
- updater support

## 11. First release channel strategy

Use simple channels:
- `dev` — only for local development
- `beta` — friends/family private builds
- `stable` — only later

For now, target `beta` only.

## 12. Bootstrap success criteria

The new repo bootstrap is complete when:
- a clean standalone repo exists
- local dev is one-command or near one-command
- packaged desktop builds work
- DB initialization/migrations work
- the team no longer depends on `demo/` as the primary implementation home
