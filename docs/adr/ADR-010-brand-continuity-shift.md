# ADR-010: Brand identity "Continuity Shift"

- **Status:** Agreed (2026-11-10). This file is a backfill: the decision was first recorded only in blueprint §0.1.
- **Phase:** 1

## Context

Opsentra needed a logo system, palette and typography that read as calm, precise and technically credible, and that hold up at favicon size.

## Decision

The **Continuity Shift** symbol: one ring split on its vertical axis, with the halves offset ±12 on a 256 grid and their end faces overlapping by 40 %. It sits with a lowercase `opsentra` wordmark in Inter SemiBold, outlined to paths. Three concepts were compared; this one was chosen after a size and "sync-icon" review. The overlap was tuned so that small sizes don't read as a refresh icon.

Approved tokens: Ops Navy `#0B1220`, Surface `#172338`, Line `#24324A`, Signal `#38BDF8`, Signal Deep `#0284C7`, Signal Ink `#0369A1`, Cloud `#F8FAFC`, Slate `#94A3B8`, and the dark/light status pairs. Fonts are Inter (UI) and IBM Plex Mono (data).

The kit and its rules live in `brand/` and `brand/BRAND_GUIDELINES.md`, which are the source of truth.

## Consequences

- The SVGs are used as supplied. The wordmark is never retyped, and the logo is never recoloured with status colours or animated as a spinner.
- Changes to the logo, palette or typography need a new ADR.
- Trademark clearance has not been done (see BRAND_GUIDELINES §10).
