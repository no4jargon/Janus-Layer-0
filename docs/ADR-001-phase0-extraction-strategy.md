# ADR-001: Phase 0 Extraction Strategy

Date: 2026-05-01
Status: accepted

## Context

The original prototype lives in `Baileys/demo` with mixed responsibilities. We need a standalone repo while avoiding disruption to the demo.

## Decision

1. Keep `Baileys/demo` untouched.
2. Copy reusable prototype files into package-local `prototype-*` files.
3. Treat copied files as read-only source material.
4. Build new package APIs beside them and migrate incrementally.
5. Standardize runtime data paths:
   - dev: `<repo>/.dev-data/`
   - prod: `<os-user-data>/data/`

## Consequences

- Fast bootstrap with lower immediate risk.
- Temporary duplication until extraction is complete.
- Clear boundary between prototype reference and product code.
