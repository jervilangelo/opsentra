# ADR-005: Frontend stack

- **Status:** Agreed (2026-11-12). Previously "Proposed technical baseline", pending the Phase 1 spike.
- **Phase:** 1

## Context

Blueprint §0.1 proposed React + Vite + TypeScript + Tailwind + shadcn/ui and left the routing and state/query libraries open until a Phase 1 spike. The dashboard has to serve both a public, offline-capable Demo Mode and an authenticated Live Mode that fails closed. Those two data sources must never be mixed.

## Decision

| Concern | Choice |
|---|---|
| Build / language | Vite 8, React 19, TypeScript 6 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`), brand tokens as CSS variables in `src/styles/tokens.css` |
| Components | shadcn/ui pattern on `radix-ui` primitives, added only as needed; icons from `lucide-react` |
| Routing | React Router (`createBrowserRouter`, basename from Vite `BASE_URL` so a GitHub Pages sub-path works) |
| Server state | TanStack Query. Query keys always start with the mode (`['demo', …]` / `['live', …]`), and switching mode drops the cache |
| Client state | Zustand: mode (not persisted, so a reload always starts in the default Demo mode) and UI preferences (persisted) |
| Fonts | Self-hosted Inter and IBM Plex Mono via Fontsource (no third-party requests, works offline) |
| Tests | Vitest + Testing Library + jsdom + vitest-axe; Playwright + axe-core for demo-only E2E |
| Lint / format | ESLint 9 flat config (typescript-eslint strict, react-hooks, jsx-a11y) and Prettier |

Demo/Live isolation: pages read data only through the `DataSource` interface (`src/api/data-source.ts`). `src/modes/demo` and `src/modes/live` each implement it, and an ESLint `no-restricted-imports` rule stops either one importing the other.

## Consequences

- ESLint is pinned to v9 because `eslint-plugin-jsx-a11y` does not support ESLint 10 yet. Revisit when it does.
- `npm audit` reports moderate advisories in the typescript-eslint dev toolchain (`minimatch`). They are dev-only and not shipped in the bundle. Re-check in Phase 9.
- On Windows, Vitest and Vite need the drive letter normalised (`scripts/run-vitest.mjs`, `vite.config.ts`). Otherwise a lowercase `c:\` path loads the Vitest runner twice and puts two copies of React in the bundle.
- The production JS bundle is ~523 kB (~161 kB gzip). Route-level code splitting is deferred to Phase 9 (optimisation).
