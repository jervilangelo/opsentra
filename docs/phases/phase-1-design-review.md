# Phase 1 design review checklist

Reusable checklist for UI changes, with Phase 1 results. "Automated" means a check in CI (Vitest + vitest-axe, Playwright + axe-core). "Manual" means it was reviewed from the gate screenshots.

## Checklist

| # | Check | How | Phase 1 result |
|---|---|---|---|
| 1 | Mode banner visible on every app page, with the exact label text | Automated (unit + E2E) | Pass |
| 2 | Live mode shows an error and no synthetic data | Automated (unit + E2E) | Pass |
| 3 | Status never shown by colour alone (text label + distinct icon per tone) | Automated (badge tests) + manual | Pass |
| 4 | Signal used for brand/primary/active only, never for health | Manual | Pass. `info` tone (Signal) is used only for in-progress states like Remediating/Verifying, as BRAND_GUIDELINES §3 allows; `LOW` severity uses the neutral tone. |
| 5 | WCAG 2.2 AA contrast, dark theme | Automated axe on all pages, desktop + mobile | Pass |
| 6 | WCAG 2.2 AA contrast, light theme | Automated axe on Overview, Incidents, Audit & Settings | Pass after two fixes (below) |
| 7 | Visible focus on all interactive elements | E2E checks the focused nav link has an outline; global `:focus-visible` ring | Pass |
| 8 | Skip link is first in tab order | Automated (E2E) | Pass |
| 9 | Heading order (one `h1` per page, no skipped levels) | Automated (axe) | Pass after one fix (below) |
| 10 | No horizontal page scroll at 412 px (Pixel 7) and 1440 px | Automated (E2E `scrollWidth` check) | Pass. Wide tables scroll inside their own focusable region. |
| 11 | Scrollable regions are keyboard-reachable | Automated (axe) | Pass after one fix (below) |
| 12 | `prefers-reduced-motion` respected | Global CSS reset; the brand shift is gated by `motion-safe:` (unit test) | Pass |
| 13 | Logo used as supplied; never spun or tinted for status/mode | Manual + BrandSymbol test | Pass. The symbol component uses the kit's exact path data split per half. |
| 14 | Timestamps in IBM Plex Mono with tabular numerals, local time plus UTC source | Manual + Timestamp test | Pass |
| 15 | Placeholders clearly labelled with their phase | Manual + PlannedPanel test | Pass |
| 16 | Missing data shown as "Not recorded" / "No evidence yet" / "—", never as zero | Manual + Timestamp test | Pass |
| 17 | No credentials form; no password fields | Automated (route test) | Pass |
| 18 | Build contains only public config | Grep of `dist/` for key patterns and 12-digit IDs | Pass (nothing found) |

## Issues found and fixed during review

1. **Heading order.** Planned panels and empty/error states used `h3` directly under the page `h1` (axe `heading-order`). They now use `h2`.
2. **Light-theme badge contrast.** Amber `#B45309` text on its own 12 % tint measured 4.25:1. On the light theme, badge text now uses the foreground ink; the status colour stays on the icon, border and tint. Dark theme is unchanged (all pairs ≥ 7:1).
3. **Light-theme primary button.** White on Signal Deep is 4.1:1, so the light `--primary` is Signal Ink (ADR-011).
4. **Keyboard access to scrolling tables (mobile).** Table scroll wrappers are now named, focusable regions.

## Contrast reference

Computed with the WCAG 2.x relative-luminance formula (status pairs as in BRAND_GUIDELINES §3).

| Pair | Ratio | Use |
|---|---|---|
| Cloud on Ops Navy | 17.89:1 | Body text, dark |
| Slate on Ops Navy | 7.30:1 | Secondary text, dark |
| Slate on Surface | 6.14:1 | Secondary text on cards, dark |
| Ops Navy on Signal | 8.74:1 | Primary button, dark |
| Slate Ink on Cloud | 7.24:1 | Secondary text, light |
| White on Signal Ink | 5.93:1 | Primary button, light |
| White on Signal Deep | 4.10:1 | Rejected for button text (ADR-011) |
| Signal Deep on Cloud | 3.91:1 | Focus ring / symbol, light (≥ 3:1 non-text) |
| Healthy / Warning / Critical on Ops Navy | 9.7 / 11.2 / 7.0:1 | Status, dark |
| Healthy / Warning / Critical (light) on white | 5.5 / 5.0 / 6.3:1 | Status icons and borders, light |

## Not yet covered

- Screen-reader walkthrough with NVDA/VoiceOver (manual; planned for the Phase 9 accessibility audit).
- Light-theme axe checks run on three pages, not all ten.
- 200 % zoom / text-spacing checks.
