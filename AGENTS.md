# AGENTS.md

Scope: repository root (`.`)

## Required reading before work

Before making changes or proposing implementation work, read:
1. `docs/PLAN.md`
2. `docs/PROGRESS.md`
3. `docs/REPO_BOOTSTRAP.md` when work touches repo setup, packaging, or dev/prod workflow
4. `README.md`
5. `docs/PROTOTYPE_MIGRATION_MAP.md` when work touches imported prototype code

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
- Treat imported `prototype-*` files as reference material to be refactored behind package boundaries.
- Prefer changes that support the planned direction:
  - desktop-first
  - local-first
  - privacy-first
  - no server-side user message storage
- Flag any change that conflicts with the plan.

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
