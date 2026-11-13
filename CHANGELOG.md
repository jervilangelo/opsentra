# Changelog

Opsentra was built in ten gated phases (blueprint §7). Each phase passed a written gate, with evidence, and was reviewed by the owner before the next began.

## v1.0.0 — 2026-11-13 · Public release

First public release: the Demo Mode on GitHub Pages, and the Live AWS workflow proven end to end.

| Phase | Delivered | Evidence |
|---|---|---|
| 1 | Brand (Continuity Shift), design tokens, dashboard foundation, page skeletons, typed DTO contract | [checkpoint](docs/phases/phase-1-checkpoint.md), [design review](docs/phases/phase-1-design-review.md) |
| 2 | Interactive Demo Mode: deterministic engine, guided scenarios A/B/C, Easy and Advanced views | [checkpoint](docs/phases/phase-2-checkpoint.md), ADR-012, ADR-013 |
| 3 | AWS foundation: Terraform state, Cognito (PKCE), API Gateway + Lambda with JWT roles, DynamoDB, CI with OIDC | ADR-014 |
| 4 | Live monitoring: disposable EC2/Nginx lab, independent probe, metric, alarm, EventBridge, Live sign-in | ADR-015 |
| 5 | Incidents: validated, deduplicated ingest, SNS alert, operator workflow, append-only audit, reconciler, verified self-heal | [checkpoint](docs/phases/phase-5-checkpoint.md), ADR-016 |
| 6 | Approved remediation: hash-pinned runbook, admin approval, one execution per approval, verification by 3 healthy probes, escalation | [checkpoint](docs/phases/phase-6-checkpoint.md), ADR-017 |
| 7 | Live Simulation Lab: lab controller, preflight, one-run lock, cooldown, time limit, watchdog, teardown verifier | [checkpoint](docs/phases/phase-7-checkpoint.md), ADR-018 |
| 8 | Analytics and observability: Live analytics reconciled with source data, sanitized exports, structured logs, CloudWatch dashboard | [checkpoint](docs/phases/phase-8-checkpoint.md), ADR-019 |
| 9 | Security hardening: audit with no critical or high findings, CSP, narrowed IAM, threat model, runbooks, live accessibility checks, cost baseline | [test report](docs/phases/phase-9-test-report.md), ADR-020 |
| 10 | Public release: GitHub Pages workflow with bundle checks, docs and screenshots matching the build, demo video, interview guide, cost log | [checkpoint](docs/phases/phase-10-checkpoint.md), ADR-021 |

### Known limitations

- Live Scenarios B and C, a printable HTML report and tracing are not built.
- Cognito admin MFA is optional (finding F2): an owner decision is pending.
- Email alert delivery needs the SNS subscription confirmed.
- Unknown API routes return API Gateway's own 404 body (finding F1, accepted).
- Costs are per service until the `opsentra:project` cost-allocation tag is activated.
