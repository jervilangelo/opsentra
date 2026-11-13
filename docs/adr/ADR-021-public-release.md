# ADR-021: Public release on GitHub Pages

- **Status:** Agreed (2026-11-13). The owner approved Phase 10 in chat ("I approve everything").
- **Phase:** 10
- **Blueprint:** v1.12.0

## Context

Phase 10 publishes the Demo Mode, so a visitor can use it without signing in, and lets an admin show the Live workflow from the same site. Everything published must match what works, and must leak no sensitive configuration.

## Decisions

| Area | Decision |
|---|---|
| Hosting | GitHub Pages at `https://jervilangelo.github.io/opsentra/`, built and deployed by `.github/workflows/pages.yml` (push to `main`, or manual). Pages uses GitHub's own deployment token; the workflow never touches AWS. |
| Live config | The four public `VITE_*` values (blueprint §9.3) come from GitHub repository variables, not committed files (only `.env.example` is committed). Without them, the site builds Demo-only and Live says "not configured". The values were checked: none contains the account ID. |
| Live access | Cognito callback URLs and API CORS already allow the Pages origin and `/opsentra/` path (Terraform defaults since Phase 3); no AWS change is needed. |
| Bundle gate | `scripts/release/check_bundle.py` runs before upload. It fails on anything that looks like an account ID, an access or private key, a JWT, a GitHub token or a client secret, on source maps, on a missing or weak CSP, on assets outside the base path, on a missing `404.html`, or on a default mode other than Demo. |
| Deep links | `404.html` is a copy of `index.html`. The router uses `import.meta.env.BASE_URL` as its basename. |
| Site check | `scripts/release/check_site.cjs` checks, as an anonymous visitor: Demo by default with the label, deep links, the scenario control, Live asking for sign-in with no data, and no CSP violations. |
| Docs truthfulness | Stale UI wording was removed: the Architecture page no longer says "not yet deployed", and the sign-in page is no longer "arrives in Phase 3". The README, architecture overview, cost log and interview guide describe the build as tested. Live screenshots come from gate runs. |
| Video | A Demo walkthrough recorded with Playwright (`scripts/release/record_demo.cjs`): synthetic data, labelled on every frame. A Live video is not published: Live evidence is the gate timelines and screenshots. |
| Version | `v1.0.0`, as a git tag with `CHANGELOG.md`. |
| License | **Not chosen:** an owner decision. Until then, all rights are reserved, as the README states. |

## Consequences

- The public site costs nothing on AWS: Demo Mode makes no AWS calls. Live calls happen only after a Cognito sign-in.
- Anyone can see the public `VITE_*` values in the built JavaScript. That is by design: they identify public endpoints and a public client with no secret.
- A Pages build can't leak an account ID or a key unnoticed: the bundle gate fails the deploy first.
