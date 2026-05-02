# Desktop-First Local-First Communications Workspace Plan

Status: planning document
Owner: Anuj
Location: `janus-layer-0/docs/PLAN.md` (moved from `demo/`).

## 1. Product definition

Build a **desktop-first, local-first communications workspace** for freelancers that:
- connects personal WhatsApp
- connects Gmail
- shows both in one workspace
- lets users cluster chats/threads by client or project
- lets users select messages and run LLM analysis on them
- keeps user data on-device by default

## 2. Hard constraints

- Rapid development is required.
- User data should **not** be stored on our servers.
- The product should be usable on desktop first, with mobile support later.
- Privacy-first behavior is a product requirement, not a nice-to-have.
- Updates, migrations, and recovery flows must eventually be usable by non-technical users.

## 3. Recommended distribution model

### Primary distribution
- Package as a **desktop app** first.
- Use **Electron** so the current web-tech stack can be reused.
- Distribute private beta builds via:
  - macOS `.dmg`
  - Windows installer `.exe` / `.msi`

### Why this path
- fastest path from current demo to real product
- preserves local-only storage model
- easier local DB, file, OAuth, and LLM handling
- avoids needing a hosted backend for user data

### Mobile strategy
- Mobile is **not** the primary v1 target.
- Mobile should later become a **companion** to the desktop app.
- Long-term cross-device story should use **user-owned encrypted sync** or equivalent privacy-preserving sync.

## 4. Product principles

- Desktop-first
- Local-first
- Single-user in v1
- Privacy-first
- WhatsApp + Gmail are mirrored locally
- AI is local-by-default or uses user-provided keys
- No cloud-hosted message storage
- Updates should become automatic and enforceable when needed

## 5. v1 scope

### In scope
- packaged desktop app
- WhatsApp connector
- Gmail connector
- local SQLite database
- persistent clusters stored in DB
- selection of messages across channels
- AI actions on selected messages
- onboarding and settings
- logs, diagnostics, recovery actions
- startup migrations
- auto-update framework

### Out of scope for v1
- full mobile parity
- multi-user/team collaboration
- hosted SaaS inbox
- server-side message storage
- enterprise-grade WhatsApp guarantees
- official support for every provider beyond Gmail + personal WhatsApp

## 6. Architecture recommendation

### Stack
- **Electron** for the desktop shell
- **React + Vite** for UI
- **Node + TypeScript** for local backend/services
- **SQLite** for local storage
- OS keychain / secure storage for tokens and keys
- **Ollama** for local LLM support
- optional later: user-provided cloud LLM keys

### High-level package layout
```text
apps/desktop
packages/ui
packages/core
packages/db
packages/connectors-gmail
packages/connectors-whatsapp
packages/ai
packages/shared
scripts
docs
```

### Data model expectations
Store locally:
- mirrored WhatsApp chats/messages
- mirrored Gmail threads/messages
- attachments cache
- cluster definitions and memberships
- AI outputs
- settings
- sync state
- diagnostics metadata

## 7. Dev vs prod model

### Development mode
Purpose: fast iteration.

Characteristics:
- hot reload for UI
- watch mode for backend services
- dev-only data directory such as `./.dev-data/`
- verbose logs
- test/mocked modes where helpful

Typical commands:
- `dev:ui` for frontend-only work
- `dev` for full desktop app development
- `build` for packaged builds

### Production mode
Purpose: packaged user-ready app.

Characteristics:
- bundled frontend and backend
- OS-specific app-data directories
- startup migrations
- signed installers later
- updater support
- safe recovery paths for broken sessions or migrations

## 8. Update policy

### Early beta
- manual updates are acceptable
- user downloads a new installer and installs over old version

### Productized desktop app
- auto-update support should be added
- app checks current version against latest release metadata
- app can support:
  - optional update
  - required update

### Required update behavior
When a minimum supported version is enforced:
1. app launches
2. app checks release metadata
3. if local version is below minimum supported version, normal usage is blocked
4. app downloads and installs update
5. app relaunches
6. DB migrations run automatically
7. user continues in supported version

## 9. Migration strategy

### Rule
Every release may carry:
- app version
- DB schema version
- migration scripts

### Behavior
On app startup:
1. open DB
2. read schema version
3. run pending migrations in order
4. update schema version
5. continue normal startup

### Best practices
- versioned migrations (`001`, `002`, `003`, ...)
- transactional where possible
- automatic DB backup before large migrations
- clear error UI if migration fails
- recovery path for retry / restore

## 10. Phase plan

## Phase 0 — repo setup
Goal: establish a clean foundation for fast product development.

Tasks:
- create a new repository for the product
- move reusable demo code into the new repository
- define package boundaries
- set up development scripts
- document local dev workflow

Deliverables:
- monorepo or equivalent package structure
- working `dev` script
- working `build` script
- clear separation of UI, DB, connectors, AI, shared types

Exit criteria:
- app runs locally in development
- packaged app can be built
- local DB can be created in dev and prod modes

## Phase 1 — desktop MVP foundation
Goal: turn the prototype into a real desktop app shell.

Tasks:
- add Electron shell
- bootstrap React UI
- implement local DB path handling
- add migration runner
- add settings store
- add logging system
- define secure storage abstraction for secrets

Deliverables:
- app launches as desktop app without terminal usage
- base layout exists in React
- DB and logs are created automatically
- startup migration path exists

Exit criteria:
- packaged app launches successfully
- local storage paths work
- logs are written
- migrations run on startup

## Phase 2 — connectors
Goal: make the app useful with real data sources.

Tasks:
- Gmail OAuth flow
- Gmail token persistence and refresh
- Gmail sync and thread view support
- WhatsApp QR/pairing and session persistence
- WhatsApp reconnect/reset flows
- attachment caching
- connection status UI
- sync status and retry handling

Deliverables:
- user can connect Gmail without terminal work
- user can connect WhatsApp without terminal work
- synced data persists across restarts
- statuses are visible in the UI

Exit criteria:
- both connectors survive restart
- sync works reliably enough for private beta
- common failures are recoverable in-app

## Phase 3 — core product UX
Goal: make the app feel like a real product.

Tasks:
- move clusters into DB
- build real cluster CRUD
- build selection UX for messages
- make AI panel visible and usable
- support structured AI outputs
- add onboarding flow
- add settings screens
- improve UX text, empty states, and error states

Deliverables:
- persistent clusters
- visible AI actions
- structured AI results saved locally
- understandable onboarding for non-technical users

Exit criteria:
- non-technical tester can install, connect, cluster, and run AI
- cluster state survives restart
- AI results are understandable and reusable

## Phase 4 — release readiness
Goal: safely distribute to friends/family and broader beta users.

Tasks:
- create macOS and Windows installers
- add migration testing plan
- add diagnostics export
- add reconnect/reset flows
- add updater
- add optional and required update modes
- run private beta QA

Deliverables:
- installable beta builds
- update flow
- diagnostics bundle
- supportable reset/recovery UX

Exit criteria:
- install and update work reliably
- migration path is tested
- forced update path works safely
- friends/family can use the app without developer help for basic flows

## 11. Usability standard

The app should be considered usable by normal users when:
- installation requires no terminal usage
- account connection happens in-app
- connection status is always visible
- errors are understandable and actionable
- resets/retries exist for common failures
- updates are automatic or clearly guided
- privacy/storage behavior is explained in simple language

## 12. Current recommendation

Build order:
1. new repo
2. desktop shell + React app + DB foundation
3. Gmail/WhatsApp connectors
4. persistent clusters + visible AI UX
5. installers + migrations + updates + diagnostics
6. later: encrypted sync and mobile companion

## 13. Notes for future implementation

- Do not keep critical state like clusters in browser `localStorage`.
- Prefer startup migrations over installer-time migrations.
- Keep user data local.
- Treat WhatsApp support as best-effort and build recovery flows accordingly.
- Add required update enforcement only after updater reliability is proven.
- When the new repo exists, move this plan there and keep it updated.
