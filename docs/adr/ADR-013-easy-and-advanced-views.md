# ADR-013: Easy and Advanced views

- **Status:** Agreed (2026-11-12)
- **Phase:** 2 (UI scope addition)
- **Blueprint:** v1.4.0

## Context

The blueprint's primary audience (§0, §1) is recruiters and newcomers, but the dashboard is built for engineers: IDs, correlation keys, evidence tables, timelines and filters on every screen. The owner asked for a toggle. **Easy** shows less, in plain language, with big obvious buttons. **Advanced** is the existing UI, unchanged.

## Decision

- **A per-browser preference, `view: 'easy' | 'advanced'`,** stored in `localStorage` with the theme. **Easy is the default** for a new visitor. The control is labelled **View** so it is never confused with the data **mode** (Demo / Live). It sits in the top bar on desktop, in the navigation drawer on phones, and in Settings.
- **The view changes presentation only.** Both views read and write through the same `DataSource`. Incident commands go through one shared hook (`useIncidentCommands`), so roles, the state machine, expected versions, idempotency keys, the audit trail and the confirmation dialog are identical. Easy still names the resource, environment and action in every confirmation and still requires an audited reason, pre-filled with an editable plain default.
- **Easy navigation** shows four destinations: Home, Incidents, Practice lab, Activity & settings. Infrastructure, Recovery Center, Analytics and Architecture are hidden from the Easy nav but still reachable by switching to Advanced or by URL. Page `h1`s are the same in both views.
- **Easy screens** answer one question: *"Is everything OK, and if not, what do I press next?"*
  - **Home:** one sentence answer and one action.
  - **Incident:** a plain state sentence, a **recovery path** (Spotted → Owned → Fix approved → Fix ran → Checked → Resolved) built from the incident's own timestamps, one next-step button, and a plain "What happened" list.
  - **Practice lab:** one scenario and one button.
  - **Activity:** sentences naming who did what to which problem.
  - **Demo bar:** Skip ahead and Start over only.
- **Visual language** comes from the taste skill's app-screen run (style `true-black-flat`, seed 1702412291, with the brand palette and type kept):
  - panels separated by one lightness step and no border on dark;
  - one primary action per screen, made primary by inversion (a Cloud pill with Navy text), 44 px tall;
  - Signal used only on data (the recovery path);
  - no resting shadows (also removed from the two segmented switches).

## Consequences

- **The style's "never navy" rule is overridden by the approved brand** (ADR-010: Ops Navy ground). Brand tokens are unchanged.
- **Confirmation dialogs keep the shared Signal-filled confirm button** in both views, for consistency with Advanced.
- **Easy wording is generated from data by pure functions** (`src/features/easy/plain.ts`), all unit-tested. Easy never shows a fact Advanced does not.
- **Tests:** existing tests and E2E specs pin the Advanced view; Easy has its own unit, flow, axe and E2E coverage.
