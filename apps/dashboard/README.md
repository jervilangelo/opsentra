# Opsentra dashboard

React + Vite + TypeScript (strict) frontend for Opsentra. Phases 1–2: navigation, the component library, typed DTOs, a fail-closed Demo/Live mode guard, and a fully interactive Demo Mode driven by a deterministic in-browser engine (ADR-012). Live AWS Mode is **not connected yet** and always shows an error instead of data.

## Requirements

- Node 24 (see the repo `.nvmrc`), npm

## Scripts

| Command                           | What it does                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `npm run dev`                     | Dev server on http://localhost:5173                                                                 |
| `npm run build`                   | Typecheck and production build to `dist/`                                                           |
| `npm run preview`                 | Serve the build on http://localhost:4173                                                            |
| `npm run lint`                    | ESLint (typescript-eslint strict, react-hooks, jsx-a11y)                                            |
| `npm run format` / `format:check` | Prettier                                                                                            |
| `npm run typecheck`               | `tsc -b`                                                                                            |
| `npm test`                        | Vitest unit and component tests (including axe checks)                                              |
| `npm run e2e`                     | Playwright demo-only smoke tests on desktop and mobile (run `npx playwright install chromium` once) |

`npm test` goes through `scripts/run-vitest.mjs`, which normalises the Windows drive letter. Without it, Vitest fails every suite when started from a lowercase `c:\` path (as VS Code terminals do).

To refresh gate screenshots: `SCREENSHOTS=1 npm run e2e` (written to `docs/phases/phase-1/` and `phase-2/screenshots/`).

## Easy and Advanced views

The **View** switch (top bar; navigation drawer on phones; Settings) chooses how much is shown. **Easy**, the default, has four plain-language pages, one next step per screen and a recovery path on each incident. **Advanced** is the full engineering interface. Both use the same data source, roles, guards and audit (ADR-013). Easy wording is built from data by `src/features/easy/plain.ts`.

## Using Demo Mode

Open **Simulation Lab → Start scenario** and follow the guided walkthrough on Overview. The demo bar under the header controls the simulated clock (pause, speed, **Next event**), the **simulated role** (Administrator, Operator or Viewer) and **Reset demo**. State is kept in `sessionStorage` for the current tab only.

## Configuration

Copy `.env.example` to `.env.local` if needed. Only public `VITE_*` values from blueprint §9.3 are allowed. Never add secrets, AWS keys, account IDs or a Cognito client secret.

## Structure

```text
src/
├── app/            providers, router, app shell, sidebar
├── api/            DataSource interface (§4.2 routes) and error types, shared by both modes
├── components/     brand, status badges, mode banner/guard, states, dialogs, ui/ (shadcn primitives)
├── config/         public env config
├── domain/         incident state machine (§4.4) and analytics (§4.5), mode-agnostic
├── features/       one folder per page (overview, incidents, …); easy/ holds the Easy view
├── modes/
│   ├── demo/       demo engine (engine/), session store, data source; never calls the network
│   ├── live/       live data source (always fails closed until Phase 3–4)
│   ├── data-hooks  TanStack Query hooks; query keys always start with the mode
│   ├── mode-store  current mode (Zustand, not persisted)
│   └── session     current role (simulated in Demo; Cognito in Live, Phase 3)
├── stores/         UI preferences (theme, sidebar), persisted in localStorage
├── styles/         tokens.css (brand tokens) and Tailwind entry
└── types/          blueprint §2.4 DTOs, API envelopes, display mappings
```

ESLint stops `modes/live` and `modes/demo` from importing each other.

## Brand assets

`public/` holds copies of the approved kit (`brand/web/*` and selected SVGs). `brand/` at the repo root is the source of truth. If the kit changes, copy the files again; never edit or redraw them here.
