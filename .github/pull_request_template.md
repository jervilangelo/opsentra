## What and why

<!-- One or two sentences. Link the blueprint section or ADR. -->

## Phase

<!-- e.g. Phase 2: Demo Mode -->

## Checklist (blueprint §7.1, §10.3)

- [ ] Scope matches the current phase; no unplanned scope change (or an ADR is included)
- [ ] Relevant checks pass: lint, typecheck, tests, build (and `terraform fmt -check` / `validate` if IaC changed)
- [ ] No unlabelled mock data in Live Mode; Demo data is labelled `DEMO — SYNTHETIC DATA`
- [ ] Auth/IAM impact reviewed (authorization enforced in the backend, never only in the UI)
- [ ] Cost impact stated for any new AWS service
- [ ] No secrets, keys, tokens, account IDs or credit balances in code, logs or screenshots
- [ ] No AWS write from this PR's CI
- [ ] Docs, README and blueprint updated where behaviour changed
- [ ] Screenshots attached for UI changes (no identifiers visible)
