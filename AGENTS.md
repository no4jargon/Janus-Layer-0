# AGENTS.md

Scope: repository root (`.`)

## Required reading before work

Before making changes or proposing implementation work, read:
1. `docs/PLAN.md`
2. `docs/PROGRESS.md`
3. `docs/RELEASE.md` when work touches packaging, releases, or update behavior
4. `docs/QA_PLAN.md` when work touches user-facing flows
5. `README.md`

## Purpose

This repository is the standalone product workspace for a **desktop-first, local-first communications app** for freelancers.

`docs/PLAN.md` is the source of truth for:
- product direction
- architecture direction
- phase plan
- update/migration strategy
- distribution model

`docs/PROGRESS.md` is the source of truth for:
- current phase
- completed work
- blockers
- current risks
- next steps

## Agent instructions

- Refer to `docs/PLAN.md` before suggesting structural or architectural changes.
- Refer to `docs/PROGRESS.md` before claiming work is started/completed.
- Keep both files updated when phase status, blockers, or major decisions change.
- Prefer changes that support the planned direction:
  - desktop-first
  - local-first
  - privacy-first
  - no server-side user message storage
- Flag any change that conflicts with the plan.
- Historical prototype source copies were removed after the production package boundaries landed; use git history if legacy reference is needed.

## Documentation rules

If any of the following change, update plan/progress/docs accordingly:
- project scope
- product phase status
- storage model
- update/migration strategy
- connector behavior
- architecture boundaries
- distribution approach

## Important constraints

- Preserve privacy-first assumptions.
- Do not assume a hosted backend for storing user communications.
- Do not treat mobile as equal-scope with desktop for v1 unless the plan is explicitly changed.
- Assume updates and DB migrations must eventually be supportable for non-technical users.

## Local app reset convention

When the user says "clear the app", interpret that as clearing everything related to Chai unless they specify a narrower scope. On macOS, this includes deleting the entire app data directory:

`~/Library/Application Support/Chai`

When working in development mode, also include repo-local development data such as `.dev-data`. Because this is destructive and can target files outside the workspace, confirm the exact paths and request escalation before deleting.
